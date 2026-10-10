// The agents beside each section of a draft, shared by the server and the browser.

export type AgentTask = "table" | "stats" | "faq" | "meta" | "links";

export const AGENT_TASKS: { id: AgentTask; label: string; hint: string; first?: boolean }[] = [
  { id: "table", label: "Build a table", hint: "A table in your brand's style from this section" },
  { id: "stats", label: "Pull stats from sources", hint: "Real numbers with links, from the brief's sources first" },
  { id: "links", label: "Find internal links", hint: "Pages from your sitemap to link from this section" },
  { id: "faq", label: "Add FAQ schema", hint: "FAQPage schema from the questions the draft answers" },
  { id: "meta", label: "Write meta title and description", hint: "For search results, saved for publishing", first: true },
];

export type DocPublishMeta = { title?: string; description?: string; slug?: string; image?: string; schema?: string };

export type WriterAgentResult =
  | { task: "table"; table: { caption: string; head: string[]; rows: string[][] } }
  | { task: "stats"; stats: { stat: string; source: string; url: string; year: string }[] }
  | { task: "faq"; faq: { q: string; a: string }[]; schema: string }
  | { task: "meta"; meta: { title: string; description: string; slug: string } }
  | { task: "links"; links: { anchor: string; url: string }[] };
