import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";
import { charge, claudeCost } from "./meter";
import type { Source } from "./sources";

export function claudeModel() {
  return process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
}

// The newer web search filters results before Claude reads them, so answers cost fewer input tokens.
const SEARCH_TOOL = "web_search_20260209" as const;

/** Ask Claude one question. With `searches` above 0, Claude can search the web that many times. */
export async function askClaude(
  prompt: string,
  opts: { searches?: number; maxTokens?: number; model?: string; effort?: "low" | "medium" | "high"; schema?: Record<string, unknown> } = {},
): Promise<{ text: string; sources: Source[] }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let text = "";
  const sources: Source[] = [];
  const model = opts.model ?? claudeModel();
  // A long web search turn can pause. Send it back so Claude can finish (a few times at most).
  for (let turn = 0; turn < 4; turn++) {
    const msg = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 16000,
      messages,
      // With a schema, the API makes sure the reply is valid JSON in that shape.
      ...(opts.effort || opts.schema
        ? { output_config: { ...(opts.effort ? { effort: opts.effort } : {}), ...(opts.schema ? { format: { type: "json_schema" as const, schema: opts.schema } } : {}) } }
        : {}),
      ...(opts.searches ? { tools: [{ type: SEARCH_TOOL, name: "web_search" as const, max_uses: opts.searches }] } : {}),
    });
    const u = msg.usage;
    charge("claude", claudeCost(model, (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) * 0.1 + (u.cache_creation_input_tokens ?? 0) * 1.25, u.output_tokens ?? 0, u.server_tool_use?.web_search_requests ?? 0));
    for (const block of msg.content) {
      if (block.type !== "text") continue;
      text += block.text;
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location") sources.push({ url: c.url, title: c.title, domain: "" });
      }
    }
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  return { text, sources };
}

/** Ask Claude for JSON in a fixed shape. No web search: structured replies cannot carry search citations. */
export async function askJson<T>(prompt: string, schema: Record<string, unknown>, opts: { maxTokens?: number; model?: string; effort?: "low" | "medium" | "high" } = {}): Promise<T> {
  const { text } = await askClaude(prompt, { ...opts, schema });
  return parseJson(text) as T;
}

/** Pull the first JSON object out of a reply. */
export function parseJson(text: string): Record<string, unknown> {
  const t = text.replace(/```(?:json)?/g, "");
  const raw = t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1);
  try {
    return JSON.parse(raw);
  } catch {
    // Replies sometimes come back with small mistakes, like a missing quote or comma. Fix them.
    return JSON.parse(jsonrepair(raw));
  }
}
