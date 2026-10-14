import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askJson, claudeModel, parseJson } from "./claude";
import { addLink, capsOf, faqHtml, faqsIn, getItem, imagesWithoutAlt, linksIn, listItems, setAlts, snapshot, textOf, writeItem, type Caps, type Fields, type Item, type ItemType } from "./cmsEdit";
import type { CmsKind } from "./cmsTypes";
import { take } from "./entitlements";
import { charge, claudeCost } from "./meter";

// Plays: Zippie's site-wide fixes. Each one reads the CMS, proposes a change per page,
// and waits in a change set until someone approves it. Applying and undoing also live here.

export type Play = "alt" | "meta" | "schema" | "faq" | "links";
export const PLAYS: Record<Play, { label: string; cap: keyof Omit<Caps, "note">; limit: number; cost: (n: number) => number; what: string }> = {
  alt: { label: "Alt text", cap: "alt", limit: 10, cost: (images) => images * 2, what: "Writes a short description for images that have none, by looking at each image." },
  meta: { label: "SEO titles and meta descriptions", cap: "meta", limit: 20, cost: (pages) => pages, what: "Rewrites missing or too-long SEO titles and meta descriptions." },
  schema: { label: "Structured data", cap: "schema", limit: 50, cost: (pages) => Math.max(1, Math.ceil(pages / 10)), what: "Adds Article, WebPage and FAQ structured data (JSON-LD) to pages that have none." },
  faq: { label: "FAQ sections", cap: "faq", limit: 5, cost: (pages) => pages * 5, what: "Adds 3 to 5 questions buyers really ask, with answers from the page, to the end of each post." },
  links: { label: "Internal links", cap: "links", limit: 10, cost: (pages) => pages * 3, what: "Links each post to up to 3 related pages on your site, using words already in the text." },
};

type Conn = { id: string; kind: CmsKind; name: string; config: Record<string, string> };
type Proposal = { item: Item; after: Record<string, unknown>; note: string; images?: number };
const FIELD: Record<Play, string> = { alt: "alt", meta: "meta", schema: "schema", faq: "faq", links: "links" };

const clip = (s: string, n: number) => {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), n - 12)).replace(/[,;:.\s-]+$/, "") + "…";
};
const abs = (src: string, page: string) => {
  try {
    return new URL(src, page).toString();
  } catch {
    return src;
  }
};

async function connection(db: SupabaseClient, ws: string, id: string): Promise<Conn> {
  const { data } = await db.from("cms_connections").select("id, kind, name, config").eq("id", id).eq("workspace_id", ws).maybeSingle();
  if (!data) throw new Error("That CMS connection is gone. Connect it again in Settings → Publishing.");
  return data as Conn;
}

async function brandOf(db: SupabaseClient, ws: string) {
  const { data } = await db.from("brands").select("name, domain, prompts").eq("workspace_id", ws).order("created_at").limit(1).maybeSingle();
  return data as { name: string; domain: string; prompts: string[] } | null;
}

// ─────────────── Alt text: Claude looks at each image ───────────────

async function altFor(item: Item, srcs: string[]): Promise<{ src: string; alt: string }[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = claudeModel();
  const ask = async (batch: string[]) => {
    const content: Anthropic.ContentBlockParam[] = [
      { type: "text", text: `These images are on a page titled "${item.title}". Write alt text for each: what the image shows, in plain words, under 120 characters. Name products, people or charts only if the image makes them clear. Don't start with "Image of". Reply with JSON: {"alts":[{"index":0,"alt":"..."}]}, one per image, in order.` },
      ...batch.map((s) => ({ type: "image" as const, source: { type: "url" as const, url: abs(s, item.url) } })),
    ];
    const msg = await client.messages.create({ model, max_tokens: 1200, messages: [{ role: "user", content }] });
    charge("claude", claudeCost(model, msg.usage.input_tokens ?? 0, msg.usage.output_tokens ?? 0));
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const out = (parseJson(text).alts ?? []) as { index: number; alt: string }[];
    return out.filter((a) => batch[a.index] && a.alt?.trim()).map((a) => ({ src: batch[a.index], alt: clip(a.alt, 125) }));
  };
  const usable = srcs.filter((s) => !/\.svg(\?|$)/i.test(s) && !s.startsWith("data:"));
  const out: { src: string; alt: string }[] = [];
  for (let i = 0; i < usable.length; i += 4) {
    const batch = usable.slice(i, i + 4);
    try {
      out.push(...(await ask(batch)));
    } catch {
      // One image Claude can't open fails the batch, so try them one at a time.
      for (const s of batch) out.push(...(await ask([s]).catch(() => [])));
    }
  }
  return out;
}

async function proposeAlt(items: Item[], opts: Options): Promise<Proposal[]> {
  const maxImages = Math.min(60, opts.images ?? 30);
  const out: Proposal[] = [];
  let used = 0;
  for (const item of items.filter((i) => imagesWithoutAlt(i.html).length).sort((a, b) => imagesWithoutAlt(b.html).length - imagesWithoutAlt(a.html).length)) {
    if (used >= maxImages || out.length >= opts.limit) break;
    const srcs = imagesWithoutAlt(item.html).slice(0, maxImages - used);
    const alts = await altFor(item, srcs);
    used += srcs.length;
    if (alts.length) out.push({ item, after: { images: alts }, note: `${alts.length} image${alts.length === 1 ? "" : "s"}`, images: alts.length });
  }
  return out;
}

// ─────────────── SEO titles and meta descriptions ───────────────

async function proposeMeta(items: Item[], opts: Options, brand: string): Promise<Proposal[]> {
  const needs = items.filter((i) => {
    const t = i.meta?.title || i.title;
    const d = i.meta?.description ?? "";
    return !d || d.length > 160 || t.length > 60;
  });
  const picked = needs.slice(0, opts.limit);
  const out: Proposal[] = [];
  for (let i = 0; i < picked.length; i += 8) {
    const batch = picked.slice(i, i + 8);
    const res = await askJson<{ items: { id: string; title: string; description: string }[] }>(
      `Write an SEO title and meta description for each page of ${brand}'s website.
Rules: title under 60 characters, with the page's main topic first. Description 130 to 155 characters, plain words, says what the reader gets. No clickbait, no invented facts or numbers, no quotes. Keep the brand name out of the title unless it's the homepage.

${batch.map((p) => `id: ${p.id}\nurl: ${p.url}\npage title: ${p.title}\ncurrent SEO title: ${p.meta?.title || "(none)"}\ncurrent description: ${p.meta?.description || "(none)"}\ntext: ${textOf(p.html).slice(0, 1200)}`).join("\n\n---\n\n")}`,
      { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" } }, required: ["id", "title", "description"], additionalProperties: false } } }, required: ["items"], additionalProperties: false },
      { maxTokens: 3000 },
    );
    for (const r of res.items ?? []) {
      const item = batch.find((b) => b.id === r.id);
      if (!item) continue;
      const after = { title: clip(r.title, 60), description: clip(r.description, 158) };
      out.push({ item, after, note: item.meta?.description ? "Rewrites a description that runs long" : "Adds a missing description" });
    }
  }
  return out;
}

// ─────────────── Structured data ───────────────

export function schemaFor(item: Item, brand: { name: string; domain: string }, site: string, faqs = faqsIn(item.html)): string {
  const desc = item.meta?.description || clip(textOf(item.html), 158);
  const img = item.image ?? item.html.match(/<img\b[^>]*\ssrc=["']([^"']+)["']/i)?.[1];
  const org = { "@type": "Organization", "@id": `${site}/#organization`, name: brand.name, url: site };
  const main =
    item.type === "post"
      ? {
          "@type": "BlogPosting",
          "@id": `${item.url}#article`,
          headline: clip(item.title, 110),
          description: desc,
          ...(item.date ? { datePublished: item.date } : {}),
          dateModified: item.modified,
          ...(item.author ? { author: { "@type": "Person", name: item.author } } : {}),
          ...(img ? { image: abs(img, item.url) } : {}),
          mainEntityOfPage: item.url,
          publisher: { "@id": `${site}/#organization` },
        }
      : { "@type": "WebPage", "@id": item.url, url: item.url, name: item.title, description: desc, isPartOf: { "@type": "WebSite", url: site, name: brand.name } };
  const graph: Record<string, unknown>[] = [main, org];
  if (faqs.length >= 2) graph.push(faqNode(item.url, faqs));
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
}

const faqNode = (url: string, faqs: { q: string; a: string }[]) => ({
  "@type": "FAQPage",
  "@id": `${url}#faq`,
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

/** Add or replace the FAQ part of a page's structured data. */
export function withFaq(schema: string, url: string, faqs: { q: string; a: string }[]): string {
  let doc: { "@context"?: string; "@graph"?: Record<string, unknown>[] } = {};
  try {
    doc = schema ? JSON.parse(schema) : {};
  } catch {
    doc = {};
  }
  const graph = (doc["@graph"] ?? (doc["@context"] ? [doc as Record<string, unknown>] : [])).filter((n) => n["@type"] !== "FAQPage");
  return JSON.stringify({ "@context": "https://schema.org", "@graph": [...graph.map((n) => ({ ...n, "@context": undefined })), faqNode(url, faqs)] });
}

function proposeSchema(items: Item[], opts: Options, brand: { name: string; domain: string }, site: string): Proposal[] {
  return items
    .filter((i) => !i.schema)
    .slice(0, opts.limit)
    .map((item) => {
      const faqs = faqsIn(item.html);
      return { item, after: { json: schemaFor(item, brand, site, faqs) }, note: `${item.type === "post" ? "Article" : "Web page"}${faqs.length >= 2 ? ` and ${faqs.length} FAQs` : ""}` };
    });
}

// ─────────────── FAQ sections ───────────────

async function proposeFaq(items: Item[], opts: Options, kind: CmsKind, brand: { name: string; prompts: string[] } | null): Promise<Proposal[]> {
  const picked = items.filter((i) => i.type === "post" && faqsIn(i.html).length < 2 && !/frequently asked questions/i.test(i.html)).slice(0, opts.limit);
  const prompts = (brand?.prompts ?? []).slice(0, 60);
  const out: Proposal[] = [];
  for (const item of picked) {
    const res = await askJson<{ items: { q: string; a: string }[] }>(
      `Add an FAQ section to this article on ${brand?.name ?? "the company"}'s website. Write 3 to 5 questions a buyer would really ask an AI assistant about this topic, and answer each in 40 to 80 words using only facts from the article. Don't invent numbers, prices, customers or claims. Questions end with a question mark.
${prompts.length ? `\nQuestions the company tracks in AI answers (reuse their wording when one fits this article):\n${prompts.map((p) => `- ${p}`).join("\n")}\n` : ""}
Article title: ${item.title}
Article: ${textOf(item.html).slice(0, 9000)}`,
      { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"], additionalProperties: false } } }, required: ["items"], additionalProperties: false },
      { maxTokens: 2500 },
    );
    const faqs = (res.items ?? []).filter((f) => f.q?.trim().endsWith("?") && f.a?.trim()).slice(0, 5).map((f) => ({ q: f.q.trim(), a: f.a.trim() }));
    if (faqs.length >= 2) out.push({ item, after: { items: faqs, html: faqHtml(kind, faqs) }, note: `${faqs.length} questions` });
  }
  return out;
}

// ─────────────── Internal links ───────────────

async function proposeLinks(items: Item[], opts: Options): Promise<Proposal[]> {
  const index = items.filter((i) => i.title).slice(0, 150);
  const picked = items.filter((i) => i.type === "post").sort((a, b) => linksIn(a.html).length - linksIn(b.html).length).slice(0, opts.limit);
  const out: Proposal[] = [];
  for (const item of picked) {
    const have = new Set(linksIn(item.html));
    const others = index.filter((o) => o.url !== item.url && !have.has(o.url.replace(/\/$/, "")));
    if (!others.length) continue;
    const res = await askJson<{ links: { anchor: string; url: string }[] }>(
      `Suggest up to 3 internal links for this article. Each link turns a short phrase that already appears word for word in the article text into a link to a related page from the list. Pick phrases of 2 to 6 words that describe the target page, never a heading. Only link pages that would really help the reader.

Pages you can link to:
${others.map((o) => `- ${o.title}: ${o.url}`).join("\n")}

Article: ${item.title}
${textOf(item.html).slice(0, 8000)}`,
      { type: "object", properties: { links: { type: "array", items: { type: "object", properties: { anchor: { type: "string" }, url: { type: "string" } }, required: ["anchor", "url"], additionalProperties: false } } }, required: ["links"], additionalProperties: false },
      { maxTokens: 800 },
    );
    let html = item.html;
    const links: { anchor: string; url: string; to: string }[] = [];
    for (const l of res.links ?? []) {
      const to = others.find((o) => o.url === l.url);
      if (!to || links.some((x) => x.url === l.url)) continue;
      const r = addLink(html, l.anchor, l.url);
      if (!r.ok) continue;
      html = r.html;
      links.push({ anchor: l.anchor, url: l.url, to: to.title });
      if (links.length >= 3) break;
    }
    if (links.length) out.push({ item, after: { links }, note: `${links.length} link${links.length === 1 ? "" : "s"}` });
  }
  return out;
}

// ─────────────── Propose, apply, undo ───────────────

export type Options = { limit: number; ids?: string[]; images?: number };

/** Build a change set's proposals in the background. */
export async function preparePlay(db: SupabaseClient, setId: string) {
  const { data: set } = await db.from("change_sets").select("id, workspace_id, connection_id, play, options").eq("id", setId).maybeSingle();
  if (!set) return;
  const step = (s: string) => db.from("change_sets").update({ step: s }).eq("id", setId);
  try {
    const play = set.play as Play;
    const conn = await connection(db, set.workspace_id, set.connection_id);
    const caps = await capsOf(conn.kind, conn.config);
    if (!caps[PLAYS[play].cap]) throw new Error(caps.note ?? `${conn.name} can't take ${PLAYS[play].label.toLowerCase()} yet.`);
    await step(`Reading ${conn.name}`);
    const opts = { limit: PLAYS[play].limit, ...(set.options as Partial<Options>) } as Options;
    let items = await listItems(conn.kind, conn.config, 300);
    if (opts.ids?.length) items = items.filter((i) => opts.ids!.includes(i.id) || opts.ids!.includes(i.url));
    const brand = await brandOf(db, set.workspace_id);
    const site = items[0] ? new URL(items[0].url).origin : `https://${brand?.domain ?? ""}`;
    const brandInfo = { name: brand?.name ?? new URL(site).hostname, domain: brand?.domain ?? new URL(site).hostname };

    await step(`Working on ${PLAYS[play].label.toLowerCase()}`);
    const proposals =
      play === "alt" ? await proposeAlt(items, opts)
      : play === "meta" ? await proposeMeta(items, opts, brandInfo.name)
      : play === "schema" ? proposeSchema(items, opts, brandInfo, site)
      : play === "faq" ? await proposeFaq(items, opts, conn.kind, brand)
      : await proposeLinks(items, opts);
    if (!proposals.length) {
      await db.from("change_sets").update({ status: "ready", step: "Nothing to change: every page already looks good for this." }).eq("id", setId);
      return;
    }
    const units = play === "alt" ? proposals.reduce((n, p) => n + (p.images ?? 0), 0) : proposals.length;
    const took = await take(set.workspace_id, "tasks", PLAYS[play].cost(units), { refundIfFree: false });
    if (!took.ok) throw new Error(((await took.response.json()) as { error: string }).error);
    const rows = proposals.map((p) => ({
      change_set_id: setId,
      workspace_id: set.workspace_id,
      target_type: p.item.type,
      target_id: p.item.id,
      url: p.item.url,
      label: p.item.title,
      field: FIELD[play],
      before: play === "meta" ? { title: p.item.meta?.title ?? "", description: p.item.meta?.description ?? "" } : null,
      after: p.after,
      note: p.note,
    }));
    const { error } = await db.from("changes").insert(rows);
    if (error) throw new Error(error.message);
    await db.from("change_sets").update({ status: "ready", step: `${rows.length} change${rows.length === 1 ? "" : "s"} ready to review` }).eq("id", setId);
  } catch (e) {
    await db.from("change_sets").update({ status: "failed", error: e instanceof Error ? e.message : String(e) }).eq("id", setId);
  }
}

type Change = { id: number; target_type: ItemType; target_id: string; field: Play; before: Record<string, unknown> | null; after: Record<string, unknown>; status: string };

/** The fields a change writes, worked out against the page as it is now. */
function fieldsFor(c: Change, item: Item, caps: Caps): { fields: Fields; keys: (keyof Fields)[] } {
  const a = c.after;
  if (c.field === "alt") {
    const r = setAlts(item.html, (a.images as { src: string; alt: string }[]) ?? []);
    if (!r.done) throw new Error("Those images already have alt text, or were removed.");
    return { fields: { html: r.html }, keys: ["html"] };
  }
  if (c.field === "meta") return { fields: { metaTitle: String(a.title ?? ""), metaDescription: String(a.description ?? "") }, keys: ["metaTitle", "metaDescription"] };
  if (c.field === "schema") return { fields: { schema: String(a.json ?? "") }, keys: ["schema"] };
  if (c.field === "faq") {
    if (/frequently asked questions/i.test(item.html)) throw new Error("This page already has an FAQ section.");
    const faqs = (a.items as { q: string; a: string }[]) ?? [];
    const f: Fields = { html: `${item.html.replace(/\s+$/, "")}\n${String(a.html ?? "")}\n` };
    if (caps.schema) f.schema = withFaq(item.schema ?? "", item.url, faqs);
    return { fields: f, keys: caps.schema ? ["html", "schema"] : ["html"] };
  }
  let html = item.html;
  let added = 0;
  for (const l of (a.links as { anchor: string; url: string }[]) ?? []) {
    if (linksIn(html).includes(l.url.replace(/\/$/, ""))) continue;
    const r = addLink(html, l.anchor, l.url);
    if (r.ok) {
      html = r.html;
      added++;
    }
  }
  if (!added) throw new Error("The linked words aren't on the page anymore, or the links are already there.");
  return { fields: { html }, keys: ["html"] };
}

/** Apply the approved changes in a set, one page at a time, keeping what each page looked like before. */
export async function applySet(db: SupabaseClient, setId: string) {
  const { data: set } = await db.from("change_sets").select("id, workspace_id, connection_id").eq("id", setId).maybeSingle();
  if (!set) return;
  let conn: Conn;
  let caps: Caps;
  try {
    conn = await connection(db, set.workspace_id, set.connection_id);
    caps = await capsOf(conn.kind, conn.config);
  } catch (e) {
    await db.from("change_sets").update({ status: "failed", error: e instanceof Error ? e.message : String(e) }).eq("id", setId);
    return;
  }
  const { data: list } = await db.from("changes").select("id, target_type, target_id, field, before, after, status").eq("change_set_id", setId).eq("status", "approved").order("id");
  let ok = 0;
  let bad = 0;
  for (const c of (list ?? []) as Change[]) {
    try {
      const item = await getItem(conn.kind, conn.config, c.target_type, c.target_id);
      const { fields, keys } = fieldsFor(c, item, caps);
      const before = { ...snapshot(item, keys), modified: item.modified };
      const modified = await writeItem(conn.kind, conn.config, c.target_type, c.target_id, fields);
      await db.from("changes").update({ status: "applied", before, after: { ...c.after, modified }, error: null, applied_at: new Date().toISOString() }).eq("id", c.id);
      ok++;
    } catch (e) {
      await db.from("changes").update({ status: "failed", error: e instanceof Error ? e.message : String(e) }).eq("id", c.id);
      bad++;
    }
    await db.from("change_sets").update({ step: `Applied ${ok + bad} of ${list?.length ?? 0}` }).eq("id", setId);
  }
  await db.from("change_sets").update({ status: bad && !ok ? "failed" : bad ? "partly" : "applied", step: `${ok} applied${bad ? `, ${bad} failed` : ""}`, applied_at: new Date().toISOString() }).eq("id", setId);
}

/** Put every page back the way it was before this set, unless someone edited it since. */
export async function undoSet(db: SupabaseClient, setId: string) {
  const { data: set } = await db.from("change_sets").select("id, workspace_id, connection_id").eq("id", setId).maybeSingle();
  if (!set) return;
  let conn: Conn;
  try {
    conn = await connection(db, set.workspace_id, set.connection_id);
  } catch (e) {
    await db.from("change_sets").update({ status: "partly", error: e instanceof Error ? e.message : String(e) }).eq("id", setId);
    return;
  }
  const { data: list } = await db.from("changes").select("id, target_type, target_id, field, before, after, status").eq("change_set_id", setId).eq("status", "applied").order("id");
  const byTarget = new Map<string, Change[]>();
  for (const c of (list ?? []) as Change[]) byTarget.set(`${c.target_type}:${c.target_id}`, [...(byTarget.get(`${c.target_type}:${c.target_id}`) ?? []), c]);
  let ok = 0;
  let kept = 0;
  for (const changes of byTarget.values()) {
    const first = changes[0];
    const last = changes[changes.length - 1];
    try {
      const item = await getItem(conn.kind, conn.config, first.target_type, first.target_id);
      if (item.modified !== last.after.modified) throw new Error("Someone edited this page after Arrowsterr changed it, so it was left as it is.");
      // Each field goes back to what it was before the first change that touched it.
      const restore: Fields = {};
      for (const c of changes) for (const [k, v] of Object.entries(c.before ?? {})) if (k !== "modified" && !(k in restore)) (restore as Record<string, unknown>)[k] = v;
      await writeItem(conn.kind, conn.config, first.target_type, first.target_id, restore);
      await db.from("changes").update({ status: "undone" }).in("id", changes.map((c) => c.id));
      ok += changes.length;
    } catch (e) {
      await db.from("changes").update({ error: e instanceof Error ? e.message : String(e) }).in("id", changes.map((c) => c.id));
      kept += changes.length;
    }
  }
  await db.from("change_sets").update({ status: kept ? "partly" : "undone", step: `${ok} undone${kept ? `, ${kept} kept because the page changed since` : ""}` }).eq("id", setId);
}
