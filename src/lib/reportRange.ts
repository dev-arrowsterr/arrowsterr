// Date ranges for reports (docs/reports.md, section 9). Pure functions, shared by the server, the browser and tests.
// Days are calendar days in the workspace's timezone, written YYYY-MM-DD. Presets end yesterday, because today is not over.

export type Preset = "last7" | "last30" | "last90" | "lastWeek" | "lastMonth" | "lastQuarter" | "mtd" | "qtd" | "ytd" | "custom";
export type Compare = "previous" | "lastYear" | "none";
export type ReportRange = { preset: Preset; start?: string; end?: string; compare: Compare };

export const PRESETS: { id: Preset; label: string }[] = [
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "last90", label: "Last 90 days" },
  { id: "lastWeek", label: "Last full week" },
  { id: "lastMonth", label: "Last full month" },
  { id: "lastQuarter", label: "Last full quarter" },
  { id: "mtd", label: "Month to date" },
  { id: "qtd", label: "Quarter to date" },
  { id: "ytd", label: "Year to date" },
  { id: "custom", label: "Custom" },
];
export const COMPARES: { id: Compare; label: string }[] = [
  { id: "previous", label: "Previous period" },
  { id: "lastYear", label: "Same period last year" },
  { id: "none", label: "No comparison" },
];
export const DEFAULT_RANGE: ReportRange = { preset: "last30", compare: "previous" };

/** A range with real dates. prevStart and prevEnd are null with no comparison, or when history doesn't reach back that far. */
export type Resolved = {
  start: string;
  end: string;
  days: number;
  prevStart: string | null;
  prevEnd: string | null;
  label: string; // "Sep 1 – Sep 30, 2026", or "September 2026" for a full month
  compareLabel: string | null;
  key: string; // the same range and comparison always give the same key
  clipped: boolean; // the plan's history cut the start short
};

const DAY = 864e5;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => toDay(toMs(d) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY) + 1; // inclusive
const parts = (d: string) => d.split("-").map(Number) as [number, number, number];
const ymd = (y: number, m: number, dd: number) => toDay(Date.UTC(y, m - 1, dd));
const lastOfMonth = (y: number, m: number) => ymd(y, m + 1, 0);
const valid = (d: unknown): d is string => typeof d === "string" && YMD.test(d) && !Number.isNaN(toMs(d)) && toDay(toMs(d)) === d;

/** Today's date in a timezone. A bad or missing timezone falls back to UTC. */
export function todayIn(tz: string | null | undefined, now = Date.now()): string {
  try {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return toDay(now);
  }
}

/** The moment a day starts in a timezone, as an ISO time. Handles daylight saving. */
export function dayStart(day: string, tz: string | null | undefined): string {
  const guess = toMs(day);
  const offsetAt = (ms: number) => {
    try {
      const p = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(ms));
      const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
      return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - ms;
    } catch {
      return 0;
    }
  };
  let at = guess - offsetAt(guess);
  at = guess - offsetAt(at); // a second pass lands right when daylight saving starts or ends that night
  return new Date(at).toISOString();
}

/** Clean a range from the database or a request. Anything odd becomes the default. */
export function parseRange(x: unknown): ReportRange {
  const r = (x && typeof x === "object" ? x : {}) as Partial<ReportRange>;
  const preset = PRESETS.some((p) => p.id === r.preset) ? (r.preset as Preset) : DEFAULT_RANGE.preset;
  const compare = COMPARES.some((c) => c.id === r.compare) ? (r.compare as Compare) : DEFAULT_RANGE.compare;
  if (preset === "custom") {
    if (!valid(r.start) || !valid(r.end)) return { preset: DEFAULT_RANGE.preset, compare };
    return r.start <= r.end ? { preset, start: r.start, end: r.end, compare } : { preset, start: r.end, end: r.start, compare };
  }
  return { preset, compare };
}

function span(r: ReportRange, today: string): [string, string] {
  const yesterday = addDays(today, -1);
  const [y, m] = parts(today);
  const q = Math.floor((m - 1) / 3); // 0 to 3
  // "To date" ranges end yesterday. On their first day there is no yesterday inside them, so they show today.
  const toDate = (start: string): [string, string] => [start, yesterday < start ? today : yesterday];
  switch (r.preset) {
    case "last7":
      return [addDays(yesterday, -6), yesterday];
    case "last90":
      return [addDays(yesterday, -89), yesterday];
    case "lastWeek": {
      const dow = (new Date(toMs(today)).getUTCDay() + 6) % 7; // Monday is 0
      const monday = addDays(today, -dow - 7);
      return [monday, addDays(monday, 6)];
    }
    case "lastMonth":
      return m === 1 ? [ymd(y - 1, 12, 1), ymd(y - 1, 12, 31)] : [ymd(y, m - 1, 1), lastOfMonth(y, m - 1)];
    case "lastQuarter": {
      const [qy, qq] = q === 0 ? [y - 1, 3] : [y, q - 1];
      return [ymd(qy, qq * 3 + 1, 1), lastOfMonth(qy, qq * 3 + 3)];
    }
    case "mtd":
      return toDate(ymd(y, m, 1));
    case "qtd":
      return toDate(ymd(y, q * 3 + 1, 1));
    case "ytd":
      return toDate(ymd(y, 1, 1));
    case "custom": {
      const end = r.end && r.end < today ? r.end : today;
      const start = r.start && r.start <= end ? r.start : end;
      return [start, end];
    }
    default:
      return [addDays(yesterday, -29), yesterday];
  }
}

const shortDate = (d: string, year: boolean) => new Date(toMs(d)).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A range written for people: "September 2026", "Q3 2026", "Sep 1 – Sep 30, 2026" or "Dec 28, 2025 – Jan 3, 2026". */
export function rangeLabel(start: string, end: string): string {
  const [sy, sm, sd] = parts(start);
  const [ey, em] = parts(end);
  if (start === end) return shortDate(start, true);
  if (sy === ey && sm === em && sd === 1 && end === lastOfMonth(ey, em)) return `${MONTHS[sm - 1]} ${sy}`;
  if (sy === ey && sd === 1 && (sm - 1) % 3 === 0 && em === sm + 2 && end === lastOfMonth(ey, em)) return `Q${(sm - 1) / 3 + 1} ${sy}`;
  if (sy === ey && sm === 1 && sd === 1 && end === ymd(ey, 12, 31)) return String(sy);
  return sy === ey ? `${shortDate(start, false)} – ${shortDate(end, true)}` : `${shortDate(start, true)} – ${shortDate(end, true)}`;
}

/** The same day a year earlier. Feb 29 becomes Feb 28. */
function yearBefore(d: string) {
  const [y, m, dd] = parts(d);
  return ymd(y - 1, m, Math.min(dd, Number(lastOfMonth(y - 1, m).slice(8))));
}

/**
 * Real dates for a range. historyDays is the plan's history: a start before it moves forward (clipped),
 * and a comparison that falls fully before it is dropped.
 */
export function resolveRange(input: ReportRange, opts: { tz?: string | null; now?: number; historyDays?: number } = {}): Resolved {
  const r = parseRange(input);
  const today = todayIn(opts.tz, opts.now);
  const [first, end] = span(r, today);
  let start = first;
  const earliest = opts.historyDays ? addDays(today, -opts.historyDays) : null;
  let clipped = false;
  if (earliest && start < earliest) {
    start = earliest > end ? end : earliest;
    clipped = true;
  }
  const days = daysBetween(start, end);
  let prevStart: string | null = null;
  let prevEnd: string | null = null;
  if (r.compare === "previous" && (r.preset === "lastMonth" || r.preset === "lastQuarter") && !clipped) {
    // A full month or quarter compares with the whole month or quarter before it, whatever its length.
    const [y, m] = parts(start);
    const back = r.preset === "lastMonth" ? 1 : 3;
    const pm = m - back < 1 ? m - back + 12 : m - back;
    const py = m - back < 1 ? y - 1 : y;
    prevStart = ymd(py, pm, 1);
    prevEnd = addDays(start, -1);
  } else if (r.compare === "previous") {
    prevEnd = addDays(start, -1);
    prevStart = addDays(prevEnd, -(days - 1));
  } else if (r.compare === "lastYear") {
    prevStart = yearBefore(start);
    prevEnd = yearBefore(end);
  }
  if (earliest && prevStart && prevEnd) {
    if (prevEnd < earliest) prevStart = prevEnd = null;
    else if (prevStart < earliest) prevStart = earliest;
  }
  return {
    start,
    end,
    days,
    prevStart,
    prevEnd,
    label: rangeLabel(start, end),
    compareLabel: prevStart && prevEnd ? rangeLabel(prevStart, prevEnd) : null,
    key: `${start}_${end}_${prevStart ?? ""}_${prevEnd ?? ""}`,
    clipped,
  };
}
