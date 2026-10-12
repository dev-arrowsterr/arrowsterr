import "server-only";
import { apiAuth } from "../integrations";
import { metered } from "../meter";
import { BAD_PARAMS, fail, INVALID_REQUEST, NO_METHOD, ok, PARSE_ERROR, ToolError, VERSIONS, errorResult, type RpcReply, type RpcRequest } from "./protocol";
import { PROMPTS, TOOLS, type Ctx } from "./tools";

const INSTRUCTIONS = `Arrowsterr tracks how AI answers (ChatGPT, Perplexity, Gemini, Claude, Google AI Overview) talk about a brand, plus its SEO and content plan.
Start with list_brands. Visibility is the share of AI answers that name the brand. Position is its average spot in the list of brands an answer names (1 is best). Sentiment is 0 to 100.
Most tools take a brand (name or domain), days (default 30) and an optional topic or AI model.
keyword_research uses the plan's tasks. add_to_content_plan and add_prompts change the workspace, so confirm with the person first.`;

/** The public address of the app, for links in auth headers. */
export function originOf(request: Request) {
  const env = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (env) return env;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "app.arrowsterr.com";
  return `${/^localhost|^127\./.test(host) ? "http" : "https"}://${host}`;
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

// A fair-use limit per workspace, so a runaway agent loop cannot burn the plan in a minute.
const WINDOW = 60_000;
const MAX_CALLS = 60;
const calls = new Map<string, number[]>();
function allowed(ws: string) {
  const now = Date.now();
  const recent = (calls.get(ws) ?? []).filter((t) => now - t < WINDOW);
  if (recent.length >= MAX_CALLS) {
    calls.set(ws, recent);
    return false;
  }
  recent.push(now);
  calls.set(ws, recent);
  if (calls.size > 5000) calls.delete(calls.keys().next().value!);
  return true;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { ...CORS, ...headers } });

/** Handle one HTTP request to the MCP endpoint. */
export async function handleMcp(request: Request): Promise<Response> {
  const challenge = { "WWW-Authenticate": `Bearer resource_metadata="${originOf(request)}/.well-known/oauth-protected-resource"` };
  const hasKey = Boolean(request.headers.get("x-api-key") || /^Bearer\s+\S/i.test(request.headers.get("authorization") ?? ""));
  if (!hasKey) return json({ error: "Sign in to Arrowsterr, or send your API key as a Bearer token or in X-API-Key." }, 401, challenge);
  const auth = await apiAuth(request);
  if ("denied" in auth) {
    const status = auth.denied.status;
    return json(await auth.denied.json(), status, status === 401 ? challenge : {});
  }
  const ctx: Ctx = { db: auth.db, ws: auth.ws };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(fail(null, PARSE_ERROR, "The body is not valid JSON."), 400);
  }
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as RpcRequest[];
  if (!messages.length) return json(fail(null, INVALID_REQUEST, "Empty batch."), 400);
  const replies: RpcReply[] = [];
  for (const m of messages) {
    const reply = await handleOne(ctx, m);
    if (reply) replies.push(reply);
  }
  // Only notifications or replies from the client: nothing to send back.
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? replies : replies[0]);
}

export async function handleOne(ctx: Ctx, m: RpcRequest): Promise<RpcReply | null> {
  if (!m || typeof m !== "object" || m.jsonrpc !== "2.0") return fail(null, INVALID_REQUEST, "Send JSON-RPC 2.0.");
  // A response from the client, or a notification: no reply.
  if (typeof m.method !== "string") return null;
  const isNote = m.id === undefined || m.id === null;
  const p = (m.params ?? {}) as Record<string, unknown>;
  switch (m.method) {
    case "initialize": {
      const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : VERSIONS[0];
      return ok(m.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: "arrowsterr", title: "Arrowsterr", version: "1.0.0", websiteUrl: "https://arrowsterr.com" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return isNote ? null : ok(m.id, {});
    case "tools/list":
      return ok(m.id, { tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations: { title, ...annotations } })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === p.name);
      if (!tool) return fail(m.id, BAD_PARAMS, `Unknown tool: ${String(p.name)}`);
      if (!allowed(ctx.ws)) return ok(m.id, errorResult(`Rate limit: ${MAX_CALLS} tool calls a minute. Wait a moment and try again.`));
      const args = p.arguments && typeof p.arguments === "object" ? (p.arguments as Record<string, unknown>) : {};
      try {
        return ok(m.id, await metered(ctx.ws, `mcp ${tool.name}`, () => tool.run(ctx, args)));
      } catch (e) {
        if (e instanceof ToolError) return ok(m.id, errorResult(e.message));
        const message = e instanceof Error ? e.message : String(e);
        console.error(`MCP ${tool.name} failed:`, message);
        return ok(m.id, errorResult(`Something went wrong: ${message}`));
      }
    }
    case "prompts/list":
      return ok(m.id, { prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args })) });
    case "prompts/get": {
      const pr = PROMPTS.find((x) => x.name === p.name);
      if (!pr) return fail(m.id, BAD_PARAMS, `Unknown prompt: ${String(p.name)}`);
      const args = Object.fromEntries(Object.entries((p.arguments ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "").slice(0, 200)]));
      return ok(m.id, { description: pr.description, messages: [{ role: "user", content: { type: "text", text: pr.text(args) } }] });
    }
    case "resources/list":
      return ok(m.id, { resources: [] });
    case "resources/templates/list":
      return ok(m.id, { resourceTemplates: [] });
    default:
      if (m.method.startsWith("notifications/")) return null;
      return isNote ? null : fail(m.id, NO_METHOD, `Unknown method: ${m.method}`);
  }
}

