import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

const hash = (s: string) => createHash("sha256").update(s).digest();

/** True when the request carries the CRON_SECRET as a Bearer token. */
export function allowed(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return Boolean(secret) && timingSafeEqual(hash(secret!), hash(given));
}
