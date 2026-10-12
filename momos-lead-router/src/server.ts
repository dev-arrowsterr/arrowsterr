import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { normalizeLead, verifyFramerSignature } from "./lead.ts";
import { routeLeadOnce } from "./router.ts";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY = 64 * 1024;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function cors(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  // Framer preview/canvas domains are allowed so the form can be tested before publishing.
  const ok =
    !!origin &&
    (ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.framer\.(app|website|ai)$/.test(origin));
  return ok
    ? {
        "access-control-allow-origin": origin!,
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        vary: "Origin",
      }
    : {};
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });

    // Server-to-server: Framer form "Webhook" destination.
    if (req.method === "POST" && url.pathname === "/webhooks/framer") {
      const raw = await readBody(req);
      const secret = process.env.FRAMER_WEBHOOK_SECRET;
      if (secret) {
        const sig = req.headers["framer-signature"] as string | undefined;
        const id = req.headers["framer-webhook-submission-id"] as string | undefined;
        if (!verifyFramerSignature(raw, sig, id, secret)) return send(res, 401, { error: "Bad signature" });
      }
      const body = parseJson(raw);
      if (!body) return send(res, 400, { error: "Expected a JSON object" });
      // Answer Framer right away; the work keeps going in the background.
      send(res, 200, { ok: true });
      routeLeadOnce(normalizeLead(body)).catch((err) => console.error("route failed", err));
      return;
    }

    // Browser: the Framer form component calls this and redirects to the answer.
    if (url.pathname === "/api/route") {
      const headers = cors(req);
      if (req.method === "OPTIONS") {
        res.writeHead(204, headers);
        return res.end();
      }
      if (req.method !== "POST") return send(res, 405, { error: "POST only" }, headers);
      const body = parseJson(await readBody(req));
      if (!body) return send(res, 400, { error: "Expected a JSON object" }, headers);
      const r = await routeLeadOnce(normalizeLead(body));
      // Only send the browser what it needs. The reasoning stays server-side.
      return send(res, 200, { outcome: r.outcome, ae: r.ae?.name ?? null, redirectUrl: r.redirectUrl }, headers);
    }

    send(res, 404, { error: "Not found" });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, () => console.log(`momos-lead-router listening on :${PORT}`));
