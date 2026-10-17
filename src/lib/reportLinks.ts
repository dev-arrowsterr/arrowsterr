// Share link rules, signed links and passwords (docs/reports.md, sections 12 and 13). No server imports, so tests can use it.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { ReportLimits } from "./plans.ts";
import type { Kind } from "./reportDoc.ts";
import type { ReportRange } from "./reportRange.ts";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** The key for signed links and cookies. Any of these server secrets works; none is ever sent to a browser. */
function secret() {
  const s = process.env.REPORT_LINK_SECRET?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || process.env.CRON_SECRET?.trim();
  if (!s) throw new Error("Set REPORT_LINK_SECRET on the server.");
  return s;
}
export const sign = (text: string) => createHmac("sha256", secret()).update(text).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const checkSig = (text: string, sig: string) => /^[a-f0-9]{64}$/.test(sig) && same(sign(text), sig);

/** A link for the PDF worker to open one saved file's print page (docs/reports.md, section 32). Good for 15 minutes. */
export function filePath(fileId: string, ttlMs = 15 * 60_000, now = Date.now()) {
  const exp = now + ttlMs;
  return `/r/file/${fileId}?exp=${exp}&sig=${sign(`file:${fileId}:${exp}`)}`;
}
export const checkFile = (fileId: string, exp: string, sig: string, now = Date.now()) => Number(exp) > now && checkSig(`file:${fileId}:${exp}`, sig);

/** A link for the PDF worker to open one report's print page. Good for 15 minutes. */
export function printPath(reportId: string, range: ReportRange, ttlMs = 15 * 60_000, now = Date.now()) {
  const exp = now + ttlMs;
  const r = encodeURIComponent(JSON.stringify(range));
  return `/r/print/${reportId}?range=${r}&exp=${exp}&sig=${sign(`print:${reportId}:${exp}:${JSON.stringify(range)}`)}`;
}
export function checkPrint(reportId: string, rangeJson: string, exp: string, sig: string, now = Date.now()) {
  return Number(exp) > now && checkSig(`print:${reportId}:${exp}:${rangeJson}`, sig);
}

/** Passwords on share links: scrypt with a random salt. */
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}
export async function checkPassword(pw: string, stored: string) {
  const [kind, salt, key] = stored.split("$");
  if (kind !== "scrypt" || !salt || !key) return false;
  const got = await scryptAsync(pw, Buffer.from(salt, "hex"), 32);
  return same(got.toString("hex"), key);
}
/** The cookie that remembers a link's password was entered, for 30 days. */
export const unlockCookie = (token: string) => `rl_${token.slice(0, 16)}`;
export const unlockValue = (token: string, hash: string) => sign(`unlock:${token}:${hash}`);

export type LinkAsk = { mode: "live" | "frozen"; kind: Kind; password: string; expires: Date | null };

/** Why a link can't be made, with limit = true when a higher plan allows it. null when it can. */
export function linkProblem(ask: LinkAsk, limits: ReportLimits, now = Date.now()): { error: string; limit?: boolean } | null {
  if (ask.mode === "live" && ask.kind !== "client") return { error: "Only client reports can be live." };
  if (ask.mode === "live" && !limits.live) return { error: "Live links are on Starter and up. Make a frozen link, or upgrade.", limit: true };
  if ((ask.password || ask.expires) && !limits.secure) return { error: "Passwords and expiry dates are on Pro and up.", limit: true };
  if (ask.password && (ask.password.length < 6 || ask.password.length > 100)) return { error: "Use a password of 6 to 100 characters." };
  if (ask.expires && (Number.isNaN(ask.expires.getTime()) || ask.expires.getTime() < now)) return { error: "Pick an expiry date in the future." };
  return null;
}

/** A report sent from the browser keeps "Made with Arrowsterr" unless the plan allows hiding it. */
export function guardWhiteLabel<T extends object>(data: T, allowed: boolean): T {
  const style = (data as { style?: { whiteLabel?: boolean } }).style;
  if (!style || typeof style !== "object") return data;
  return { ...data, style: { ...style, whiteLabel: allowed && Boolean(style.whiteLabel) } };
}
