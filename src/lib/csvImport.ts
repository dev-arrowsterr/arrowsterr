import type { Brand } from "./db";

// Reading prompts from a CSV file, for Settings → Imports and exports.

/** Read a CSV into rows of cells. Handles quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const sep = !text.includes(",") && text.includes(";") ? ";" : text.split("\n")[0].includes("\t") ? "\t" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

/** Prompts from a CSV: a "prompt" column (or the first one) and an optional "topic" column. */
export function promptsFromCsv(text: string): { prompt: string; topic: string }[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.toLowerCase());
  const hasHead = head.some((h) => h === "prompt" || h === "prompts" || h === "topic" || h === "question");
  const pi = Math.max(
    0,
    head.findIndex((h) => h === "prompt" || h === "prompts" || h === "question"),
  );
  const ti = head.findIndex((h) => h === "topic");
  return (hasHead ? rows.slice(1) : rows)
    .map((r) => ({
      prompt: (r[pi] ?? "").replace(/\s+/g, " ").trim(),
      topic: hasHead && ti >= 0 ? (r[ti] ?? "").trim() : "",
    }))
    .filter((r) => r.prompt.length > 2 && r.prompt.length <= 300);
}

/** Add imported prompts to a brand. Prompts already there are skipped; new topics are made. */
export function mergePrompts(brand: Brand, rows: { prompt: string; topic: string }[]): { brand: Brand; added: number; skipped: number } {
  const have = new Set(brand.prompts.map((p) => p.toLowerCase()));
  const topics = (brand.topics ?? []).filter((t) => t?.name).map((t) => ({ ...t, prompts: [...t.prompts] }));
  const prompts = [...brand.prompts];
  let added = 0;
  for (const r of rows) {
    if (have.has(r.prompt.toLowerCase())) continue;
    have.add(r.prompt.toLowerCase());
    prompts.push(r.prompt);
    added++;
    if (r.topic) {
      let t = topics.find((x) => x.name.toLowerCase() === r.topic.toLowerCase());
      if (!t) topics.push((t = { name: r.topic, prompts: [] }));
      t.prompts.push(r.prompt);
    }
  }
  return {
    brand: { ...brand, prompts, topics },
    added,
    skipped: rows.length - added,
  };
}
