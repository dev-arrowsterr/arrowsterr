import "server-only";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as ufetch } from "undici";
import { privateIp } from "./netCheck.ts";

// Fetching addresses a stranger typed into a free tool. The server must never reach its own network:
// every connection, including each redirect, is checked at connect time, so DNS tricks can't slip past.

// Tests only: point every name at one local address. It can never turn on in production.
const TEST_RESOLVE = process.env.NODE_ENV !== "production" ? process.env.FREE_TEST_RESOLVE?.trim() : undefined;

const agent = new Agent({
  connect: {
    timeout: 10_000,
    lookup(host, options, cb) {
      if (TEST_RESOLVE) {
        const list = [{ address: TEST_RESOLVE, family: 4 }];
        if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof list) => void)(null, list);
        return cb(null, TEST_RESOLVE, 4);
      }
      lookup(host, { ...options, all: true }, (err, addresses) => {
        if (err) return cb(err, "", 4);
        const list = Array.isArray(addresses) ? addresses : [{ address: addresses as unknown as string, family: 4 }];
        const bad = list.find((a) => privateIp(a.address));
        if (!list.length || bad) return cb(Object.assign(new Error("That address points to a private network."), { code: "EPRIVATE" }), "", 4);
        // undici asks for all addresses when options.all is set.
        if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: typeof list) => void)(null, list);
        cb(null, list[0].address, list[0].family);
      });
    },
  },
});

export const UA = "Mozilla/5.0 (compatible; ArrowsterrBot/1.0; +https://arrowsterr.com/)";

export type Fetched = { ok: boolean; status: number; url: string; chain: { url: string; status: number }[]; headers: Headers; body: string; ms: number; error?: string; bytes?: Buffer };

/**
 * GET (or HEAD) a public address. Redirects are followed by hand, up to `hops`, and each hop is recorded.
 * The body is read as text up to maxBytes. Never throws: failures come back with status 0 and an error.
 */
export async function safeFetch(url: string, opts: { method?: "GET" | "HEAD"; ua?: string; hops?: number; timeout?: number; maxBytes?: number; accept?: string; raw?: boolean } = {}): Promise<Fetched> {
  const start = Date.now();
  const chain: { url: string; status: number }[] = [];
  let current = url;
  const hops = opts.hops ?? 5;
  for (let i = 0; i <= hops; i++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return { ok: false, status: 0, url: current, chain, headers: new Headers(), body: "", ms: Date.now() - start, error: "Not a valid address." };
    }
    if (!/^https?:$/.test(u.protocol) || (isIP(u.hostname.replace(/^\[|\]$/g, "")) && privateIp(u.hostname.replace(/^\[|\]$/g, "")))) {
      return { ok: false, status: 0, url: current, chain, headers: new Headers(), body: "", ms: Date.now() - start, error: "That address can't be checked." };
    }
    try {
      const res = await ufetch(current, {
        method: opts.method ?? "GET",
        redirect: "manual",
        dispatcher: agent,
        headers: { "User-Agent": opts.ua ?? UA, Accept: opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8" },
        signal: AbortSignal.timeout(opts.timeout ?? 15_000),
      });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location && i < hops) {
        chain.push({ url: current, status: res.status });
        await res.body?.cancel().catch(() => {});
        current = new URL(location, current).toString();
        continue;
      }
      let body = "";
      if ((opts.method ?? "GET") === "GET" && res.body) {
        const max = opts.maxBytes ?? 3_000_000;
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
          size += value.byteLength;
          if (size >= max) {
            await reader.cancel().catch(() => {});
            // raw: a file cut short is useless, so it fails instead.
            if (opts.raw) return { ok: false, status: res.status, url: current, chain, headers: res.headers as unknown as Headers, body: "", ms: Date.now() - start, error: "It is too large." };
            break;
          }
        }
        if (opts.raw) return { ok: res.ok, status: res.status, url: current, chain, headers: res.headers as unknown as Headers, body: "", bytes: Buffer.concat(chunks), ms: Date.now() - start };
        body = new TextDecoder().decode(Buffer.concat(chunks)).slice(0, max);
      } else await res.body?.cancel().catch(() => {});
      return { ok: res.ok, status: res.status, url: current, chain, headers: res.headers as unknown as Headers, body, ms: Date.now() - start };
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string; message?: string }; name?: string; message?: string };
      const code = err.cause?.code ?? err.code;
      const message = code === "EPRIVATE" ? "That address points to a private network." : err.name === "TimeoutError" ? "It took too long to answer." : code === "ENOTFOUND" ? "That domain doesn't exist." : "It couldn't be reached.";
      return { ok: false, status: 0, url: current, chain, headers: new Headers(), body: "", ms: Date.now() - start, error: message };
    }
  }
  return { ok: false, status: 0, url: current, chain, headers: new Headers(), body: "", ms: Date.now() - start, error: "Too many redirects." };
}
