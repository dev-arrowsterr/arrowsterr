// The agents beside each heading of a draft, shared by the server and the browser.

export type AgentTask = "write" | "table" | "widget" | "stats" | "links" | "faq" | "meta" | "custom";

export const AGENT_TASKS: Record<Exclude<AgentTask, "custom">, { label: string; hint: string }> = {
  write: { label: "Write this section", hint: "Drafts it from the guide, the brief and your brand voice" },
  table: { label: "Make a table", hint: "A comparison or summary table for this section" },
  widget: { label: "Code an interactive element", hint: "A calculator, quiz or comparison tool in your brand style" },
  stats: { label: "Add stats with sources", hint: "Real numbers with links, woven into the section" },
  links: { label: "Add internal links", hint: "Links to your own pages from the sitemap" },
  faq: { label: "Add FAQ schema", hint: "FAQPage schema from the answers, saved for publishing" },
  meta: { label: "Write meta title and description", hint: "Saved for publishing" },
};

/** The jobs that fit a heading best, first in the list. */
export function tasksFor(heading: string, level: number, first: boolean): Exclude<AgentTask, "custom">[] {
  const h = heading.toLowerCase();
  const faq = /question|faq/.test(h);
  const compare = /\bvs\b|versus|compar|alternativ|best|top \d|pricing|price|cost|plans?\b|features/.test(h);
  const tool = /calculat|cost|price|pricing|roi|save|estimate|quiz|which .* (right|best)|choose|checklist/.test(h);
  const out: Exclude<AgentTask, "custom">[] = ["write"];
  if (first) out.push("meta");
  if (faq && level <= 2) out.push("faq");
  if (compare) out.push("table");
  if (tool) out.push("widget");
  for (const t of ["table", "widget", "stats", "links"] as const) if (!out.includes(t)) out.push(t);
  return out;
}

export type DocPublishMeta = { title?: string; description?: string; slug?: string; image?: string; schema?: string };

export type WriterAgentResult =
  | { task: "write" | "table" | "custom" | "stats"; html: string; note?: string }
  | { task: "widget"; embed: string; note?: string }
  | { task: "faq"; faq: { q: string; a: string }[]; schema: string }
  | { task: "meta"; meta: { title: string; description: string; slug: string } }
  | { task: "links"; links: { anchor: string; url: string }[] };
