// The instant part. Pure functions, no network, runs in microseconds.

export type Region = "us_west" | "us_east" | "emea" | "apac" | "unknown";
export type AEKey = "james" | "jill";

export type FormData = {
  firstName?: string;
  lastName?: string;
  email?: string;
  company?: string;
  title?: string;
  country?: string;
  locations?: string;
  website?: string; // honeypot, real people never fill it
  region_tab?: string;
  elapsedMs?: number;
  timezone?: string;
  pageUrl?: string;
  referrer?: string;
  [utm: string]: unknown;
};

export type Instant = {
  status: "routed" | "not_fit" | "spam";
  reason: string;
  region: Region;
  ae: AEKey | null;
};

// Region -> AE
export const ROUTES: Record<Region, AEKey> = {
  us_west: "james",
  apac: "james",
  us_east: "jill",
  emea: "jill",
  unknown: "jill",
};

// Location answers that are not ICP. Empty means every bucket gets a calendar
// and Claude flags small brands in Slack. Add "1-5" here to send them to NOT_FIT_URL.
export const NOT_FIT_BUCKETS: string[] = [];

const EMEA = new Set(["GB", "IE", "FR", "DE", "ES", "IT", "NL", "TR", "AE", "SA", "QA", "KW", "BH", "OM", "PT", "BE", "CH", "AT", "SE", "NO", "DK", "FI", "PL", "GR", "IL", "EG", "ZA"]);
const APAC = new Set(["AU", "NZ", "SG", "MY", "TH", "VN", "PH", "ID", "JP", "KR", "HK", "IN", "TW", "CN", "MO"]);
const NORTH_AMERICA = new Set(["US", "CA", "MX"]);

// Pacific and Mountain time in the US, Canada and Mexico count as West Coast.
const WEST_ZONES = new Set([
  "America/Los_Angeles", "America/Denver", "America/Phoenix", "America/Boise", "America/Anchorage",
  "America/Juneau", "America/Sitka", "America/Nome", "America/Yakutat", "America/Metlakatla",
  "Pacific/Honolulu", "America/Vancouver", "America/Edmonton", "America/Whitehorse", "America/Dawson_Creek",
  "America/Tijuana", "America/Hermosillo", "America/Mazatlan", "America/Chihuahua", "America/Ciudad_Juarez",
]);
const MIDDLE_EAST_ZONES = new Set([
  "Asia/Dubai", "Asia/Riyadh", "Asia/Qatar", "Asia/Kuwait", "Asia/Bahrain", "Asia/Muscat",
  "Asia/Jerusalem", "Asia/Tel_Aviv", "Asia/Beirut", "Asia/Amman", "Asia/Baghdad", "Asia/Tehran", "Asia/Nicosia",
]);

const DISPOSABLE = new Set([
  "mailinator.com", "10minutemail.com", "guerrillamail.com", "tempmail.com", "temp-mail.org", "yopmail.com",
  "trashmail.com", "sharklasers.com", "getnada.com", "maildrop.cc", "fakeinbox.com", "throwawaymail.com",
]);

export function regionFor(country = "", timezone = ""): Region {
  const c = country.toUpperCase();
  if (NORTH_AMERICA.has(c)) return WEST_ZONES.has(timezone) ? "us_west" : "us_east";
  if (EMEA.has(c)) return "emea";
  if (APAC.has(c)) return "apac";
  // "OTHER" or blank: the visitor's time zone is the best clue we have.
  if (WEST_ZONES.has(timezone)) return "us_west";
  if (timezone.startsWith("America/")) return "us_east";
  if (MIDDLE_EAST_ZONES.has(timezone) || timezone.startsWith("Europe/") || timezone.startsWith("Africa/")) return "emea";
  if (timezone.startsWith("Asia/") || timezone.startsWith("Australia/") || timezone.startsWith("Pacific/")) return "apac";
  return "unknown";
}

export function instantRoute(d: FormData): Instant {
  const region = regionFor(String(d.country ?? ""), String(d.timezone ?? ""));
  const email = String(d.email ?? "").trim().toLowerCase();
  const domain = email.split("@")[1] ?? "";

  if (d.website) return { status: "spam", reason: "honeypot filled", region, ae: null };
  if (typeof d.elapsedMs === "number" && d.elapsedMs < 2000) return { status: "spam", reason: "form filled in under 2s", region, ae: null };
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) return { status: "spam", reason: "invalid email", region, ae: null };
  if (DISPOSABLE.has(domain)) return { status: "spam", reason: "throwaway email", region, ae: null };
  if (NOT_FIT_BUCKETS.includes(String(d.locations ?? ""))) return { status: "not_fit", reason: `${d.locations} locations`, region, ae: null };

  return { status: "routed", reason: "ok", region, ae: ROUTES[region] };
}
