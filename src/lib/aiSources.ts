// ─────────────── AI sources ───────────────

/** Sites that send visitors from AI assistants, by assistant. */
export const AI_SOURCES: Record<string, string[]> = {
  ChatGPT: ["chatgpt.com", "chat.openai.com"],
  Perplexity: ["perplexity.ai", "www.perplexity.ai"],
  Gemini: ["gemini.google.com", "bard.google.com"],
  Claude: ["claude.ai"],
  Copilot: ["copilot.microsoft.com", "copilot.cloud.microsoft"],
  "Other AI": ["chat.deepseek.com", "grok.com", "meta.ai", "you.com", "phind.com", "poe.com", "chat.mistral.ai"],
};
export function aiSourceOf(referrer: string): string | null {
  const d = referrer.toLowerCase().replace(/^www\./, "");
  for (const [name, list] of Object.entries(AI_SOURCES)) if (list.some((x) => d === x.replace(/^www\./, "") || d.endsWith(`.${x}`))) return name;
  return null;
}
