// Content (docs/content-v2.md): the brand's article library. Articles are the writer's drafts (docs),
// with the keyword, plan status and brief sources of the Content Plan piece they were written for.
// Pure helpers are shared by the browser and tests.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Published } from "./cmsTypes.ts";

export type ArticleStatus = "Draft" | "Ready" | "CMS draft" | "Published";

type Plan = { keyword: string; status: string; due_date: string | null; url: string | null; sources: string[] | null };
export type Article = {
  id: string;
  site_id: string;
  calendar_item_id: string | null;
  title: string;
  words: number;
  updated_at: string;
  keyword: string | null;
  status: ArticleStatus;
  date: string; // published, else the planned date, else last edited (YYYY-MM-DD)
  sources: number | null; // sources the brief cites; null without a brief
  url: string | null;
};

type Row = {
  id: string;
  site_id: string;
  calendar_item_id: string | null;
  title: string;
  words: number;
  updated_at: string;
  meta?: { published?: Published[]; status?: string } | null;
  calendar_items?: Plan | Plan[] | null;
};

/** Published when it went live on a site (or the plan says so), CMS draft when it was only sent as a draft. Ready once the writing job finishes. */
export function articleStatus(meta: Row["meta"], plan: Pick<Plan, "status"> | null): ArticleStatus {
  const sent = (meta?.published ?? []).filter((p) => !p.deleted); // a post deleted on the site no longer counts
  if (sent.some((p) => p.live) || plan?.status === "published") return "Published";
  if (sent.length) return "CMS draft";
  if (meta?.status === "ready") return "Ready";
  return "Draft";
}

/** One library row from a draft and its plan piece. */
export function toArticle(r: Row): Article {
  const plan = (Array.isArray(r.calendar_items) ? r.calendar_items[0] : r.calendar_items) ?? null;
  const live = (r.meta?.published ?? []).filter((p) => p.live && !p.deleted).sort((a, b) => b.at.localeCompare(a.at))[0];
  return {
    id: r.id,
    site_id: r.site_id,
    calendar_item_id: r.calendar_item_id,
    title: r.title || "Untitled",
    words: r.words ?? 0,
    updated_at: r.updated_at,
    keyword: plan?.keyword ?? null,
    status: articleStatus(r.meta, plan),
    date: (live?.at ?? plan?.due_date ?? r.updated_at).slice(0, 10),
    sources: Array.isArray(plan?.sources) ? plan.sources.length : null,
    url: live?.url ?? plan?.url ?? null,
  };
}

const COLS = "id, site_id, calendar_item_id, title, words, updated_at";

/** The brand's articles, newest first. Works before 021_doc_meta.sql, without statuses. */
export async function listArticles(sb: SupabaseClient, siteId: string): Promise<Article[]> {
  const res = await sb
    .from("docs")
    .select(`${COLS}, meta, calendar_items(keyword, status, due_date, url, sources:brief->brief->sources)`)
    .eq("site_id", siteId)
    .order("updated_at", { ascending: false });
  if (!res.error) return (res.data as unknown as Row[]).map(toArticle);
  if (!/meta|brief|calendar_items/.test(res.error.message)) throw new Error(res.error.message);
  const plain = await sb.from("docs").select(COLS).eq("site_id", siteId).order("updated_at", { ascending: false });
  if (plain.error) throw new Error(plain.error.message);
  return (plain.data as Row[]).map(toArticle);
}

// ─────────────── Markdown export ───────────────

type Mark = { type: string; attrs?: Record<string, unknown> };
type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: Mark[] };

const escMd = (s: string) => s.replace(/([\\`*_[\]])/g, "\\$1");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();

function inline(nodes: Node[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type === "image") return `![${String(n.attrs?.alt ?? "")}](${String(n.attrs?.src ?? "")})`;
      if (n.type !== "text") return inline(n.content);
      const marks = n.marks ?? [];
      const code = marks.some((m) => m.type === "code");
      let t = code ? `\`${n.text ?? ""}\`` : escMd(n.text ?? "");
      if (!code && marks.some((m) => m.type === "italic")) t = `*${t}*`;
      if (!code && marks.some((m) => m.type === "bold")) t = `**${t}**`;
      if (marks.some((m) => m.type === "strike")) t = `~~${t}~~`;
      const link = marks.find((m) => m.type === "link");
      if (link) t = `[${t}](${String(link.attrs?.href ?? "")})`;
      return t;
    })
    .join("");
}

function block(n: Node, indent = ""): string {
  const kids = n.content ?? [];
  switch (n.type) {
    case "heading":
      return `${"#".repeat(Math.min(6, Number(n.attrs?.level) || 1))} ${inline(kids)}`;
    case "paragraph":
      return indent + inline(kids);
    case "blockquote":
      return kids.map((k) => block(k)).join("\n\n").split("\n").map((l) => `> ${l}`.trimEnd()).join("\n");
    case "codeBlock":
      return `\`\`\`${String(n.attrs?.language ?? "")}\n${kids.map((k) => k.text ?? "").join("")}\n\`\`\``;
    case "horizontalRule":
      return "---";
    case "image":
      return inline([n]);
    case "bulletList":
    case "orderedList":
      return kids
        .map((li, i) => {
          const mark = n.type === "orderedList" ? `${(Number(n.attrs?.start) || 1) + i}.` : "-";
          const parts = (li.content ?? []).map((k) => (k.type === "bulletList" || k.type === "orderedList" ? block(k, `${indent}  `) : inline(k.content)));
          return `${indent}${mark} ${parts.join("\n")}`;
        })
        .join("\n");
    case "table": {
      const rows = kids.map((r) => (r.content ?? []).map((c) => cell((c.content ?? []).map((p) => inline(p.content)).join(" "))));
      if (!rows.length) return "";
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      return [line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n");
    }
    case "embed":
      return String(n.attrs?.html ?? ""); // an interactive element stays as its own HTML
    case "note":
      return ""; // notes to the writer never leave the editor
    default:
      return kids.length ? kids.map((k) => block(k, indent)).join("\n\n") : inline([n]);
  }
}

/** The editor's document as Markdown: headings, lists, links, images, tables. Interactive elements stay as HTML. */
export function docToMarkdown(doc: Node | Record<string, unknown>): string {
  const d = doc as Node;
  return (d.content ?? [])
    .map((n) => block(n))
    .filter((s) => s.trim())
    .join("\n\n")
    .concat("\n");
}
