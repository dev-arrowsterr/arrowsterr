// The agents beside each heading of a draft, shared by the server and the browser.

export type AgentTask = "write" | "table" | "widget" | "stats" | "links" | "faq" | "meta" | "custom" | "rewrite" | "paragraph";

export const AGENT_TASKS: Record<Exclude<AgentTask, "custom" | "rewrite" | "paragraph">, { label: string; hint: string }> = {
  write: { label: "Write this section", hint: "Drafts it from the guide, the brief and your brand voice" },
  table: { label: "Make a table", hint: "A comparison or summary table for this section" },
  widget: { label: "Code an interactive element", hint: "A calculator, quiz or comparison tool in your brand style" },
  stats: { label: "Add stats with sources", hint: "Real numbers with links, woven into the section" },
  links: { label: "Add internal links", hint: "Links to your own pages from the sitemap" },
  faq: { label: "Add FAQ schema", hint: "FAQPage schema from the answers, saved for publishing" },
  meta: { label: "Write meta title and description", hint: "Saved for publishing" },
};

/** The jobs that fit a heading best, first in the list. */
export function tasksFor(heading: string, level: number, first: boolean): Exclude<AgentTask, "custom" | "rewrite" | "paragraph">[] {
  const h = heading.toLowerCase();
  const faq = /question|faq/.test(h);
  const compare = /\bvs\b|versus|compar|alternativ|best|top \d|pricing|price|cost|plans?\b|features/.test(h);
  const tool = /calculat|cost|price|pricing|roi|save|estimate|quiz|which .* (right|best)|choose|checklist/.test(h);
  const out: Exclude<AgentTask, "custom" | "rewrite" | "paragraph">[] = ["write"];
  if (first) out.push("meta");
  if (faq && level <= 2) out.push("faq");
  if (compare) out.push("table");
  if (tool) out.push("widget");
  for (const t of ["table", "widget", "stats", "links"] as const) if (!out.includes(t)) out.push(t);
  return out;
}

export type DocPublishMeta = { title?: string; description?: string; slug?: string; image?: string; schema?: string };

export type WriterAgentResult =
  | { task: "write" | "table" | "custom" | "stats" | "rewrite" | "paragraph"; html: string; note?: string }
  | { task: "widget"; embed: string; note?: string }
  | { task: "faq"; faq: { q: string; a: string }[]; schema: string }
  | { task: "meta"; meta: { title: string; description: string; slug: string } }
  | { task: "links"; links: { anchor: string; url: string }[] };

/** Quick asks for a passage the writer picked: each is an instruction for the rewrite job. */
export const REWRITES: { label: string; ask: string }[] = [
  { label: "Rewrite", ask: "Rewrite it to read better. Keep the meaning and the facts." },
  { label: "Shorter", ask: "Make it shorter and tighter. Keep every fact that matters." },
  { label: "Expand", ask: "Expand it with more useful detail, an example or a step the reader needs." },
  { label: "Clearer", ask: "Make it clearer and simpler for a 9th-grade reader." },
  { label: "On-brand", ask: "Rewrite it in the brand's voice from the guideline." },
  { label: "As a list", ask: "Turn it into a short bulleted list." },
  { label: "Add proof", ask: "Add a concrete proof point from the product knowledge. Use [brackets] if a fact is missing." },
];

/** What the writing agent knows about the product, from the brand profile and the facts the team saved. */
export function knowledgeText(p: {
  card?: { who: string[]; whereTo: string[]; howTo: string[]; whySo: string[] };
  competitors?: { name: string; difference: string }[];
  position?: { price: string; size: string; region: string; summary: string[] };
  products?: string;
  customers?: string;
  features?: string;
  knowledge?: string;
} | null | undefined): string {
  if (!p) return "";
  const lines: string[] = [];
  if (p.card) {
    if (p.card.who?.length) lines.push(`Who it is for: ${p.card.who.join("; ")}`);
    if (p.card.whereTo?.length) lines.push(`What it helps them do: ${p.card.whereTo.join("; ")}`);
    if (p.card.howTo?.length) lines.push(`How it works: ${p.card.howTo.join("; ")}`);
    if (p.card.whySo?.length) lines.push(`Why it exists: ${p.card.whySo.join("; ")}`);
  }
  if (p.position?.summary?.length) lines.push(`Position: ${p.position.price} price, ${p.position.size} customers, ${p.position.region}. ${p.position.summary.join(" ")}`);
  if (p.products) lines.push(`Products: ${p.products}`);
  if (p.features) lines.push(`Features: ${p.features}`);
  if (p.customers) lines.push(`Customers: ${p.customers}`);
  if (p.competitors?.length) lines.push(`Competitors and how we differ: ${p.competitors.map((c) => `${c.name}: ${c.difference}`).join("; ")}`);
  if (p.knowledge?.trim()) lines.push(`Facts from the team (true, use them):\n${p.knowledge.trim()}`);
  return lines.join("\n");
}
