// Changes the AI can make to the Planner or the Calendar. The AI only proposes them. The page shows them, and they
// apply when you click Apply. Pure, so tests and the browser can use it.

export type SheetKind = "plan" | "calendar";
export type SheetOp =
  | { op: "select"; ids: string[] }
  | { op: "approve"; ids: string[] }
  | { op: "update"; ids: string[]; set: Record<string, string | number | null> }
  | { op: "delete"; ids: string[] }
  | { op: "add"; keywords: string[] };

const STATUS = ["planned", "brief", "writing", "published"];
const STAGE = ["bofu", "mofu", "tofu"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BUILT_IN = ["status", "due_date", "owner", "stage", "theme", "notes", "keyword"];

/** Keep only changes this sheet allows, on rows that exist, with values that fit. */
export function cleanOps(raw: unknown, kind: SheetKind, ids: Set<string>, custom: string[]): SheetOp[] {
  if (!Array.isArray(raw)) return [];
  const allowed = kind === "plan" ? ["select", "approve"] : ["select", "update", "delete", "add"];
  const out: SheetOp[] = [];
  for (const o of raw.slice(0, 500)) {
    if (!o || typeof o !== "object" || !allowed.includes((o as { op?: string }).op ?? "")) continue;
    const op = (o as { op: string }).op;
    if (op === "add") {
      const keywords = ((o as { keywords?: unknown }).keywords as unknown[] | undefined ?? [])
        .filter((k): k is string => typeof k === "string" && Boolean(k.trim()))
        .map((k) => k.trim().replace(/\s+/g, " ").slice(0, 120))
        .slice(0, 50);
      if (keywords.length) out.push({ op: "add", keywords });
      continue;
    }
    const rowIds = (((o as { ids?: unknown }).ids as unknown[] | undefined) ?? []).filter((x): x is string => typeof x === "string" && ids.has(x));
    if (!rowIds.length) continue;
    if (op !== "update") {
      out.push({ op: op as "select" | "approve" | "delete", ids: rowIds });
      continue;
    }
    const set: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(((o as { set?: unknown }).set as Record<string, unknown>) ?? {})) {
      const s = v === null ? null : typeof v === "number" ? v : typeof v === "string" ? v.trim().slice(0, 500) : undefined;
      if (s === undefined) continue;
      if (k === "status" && (typeof s !== "string" || !STATUS.includes(s))) continue;
      if (k === "stage" && s !== null && (typeof s !== "string" || !STAGE.includes(s))) continue;
      if (k === "due_date" && s !== null && (typeof s !== "string" || !DATE.test(s))) continue;
      if (k === "keyword" && (typeof s !== "string" || !s)) continue;
      if (!BUILT_IN.includes(k) && !custom.includes(k)) continue;
      set[k] = s;
    }
    if (Object.keys(set).length) out.push({ op: "update", ids: rowIds, set });
  }
  return out;
}

/** One line per change, for the preview. */
export function describeOps(ops: SheetOp[], label: (id: string) => string, columnName: (k: string) => string): string[] {
  const names = (ids: string[]) => (ids.length <= 3 ? ids.map(label).join(", ") : `${ids.length} rows`);
  return ops.map((o) =>
    o.op === "add"
      ? `Add ${o.keywords.length} ${o.keywords.length === 1 ? "keyword" : "keywords"}: ${o.keywords.slice(0, 5).join(", ")}${o.keywords.length > 5 ? "..." : ""}`
      : o.op === "update"
        ? `Set ${Object.entries(o.set)
            .map(([k, v]) => `${columnName(k)} to ${v === null || v === "" ? "empty" : v}`)
            .join(", ")} on ${names(o.ids)}`
        : `${o.op === "select" ? "Select" : o.op === "approve" ? "Approve to calendar" : "Remove"} ${names(o.ids)}`,
  );
}
