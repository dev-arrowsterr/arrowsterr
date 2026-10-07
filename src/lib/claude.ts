import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Source } from "./sources";

export function claudeModel() {
  return process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
}

/** Ask Claude one question. With `searches` above 0, Claude can search the web that many times. */
export async function askClaude(
  prompt: string,
  opts: { searches?: number; maxTokens?: number; model?: string } = {},
): Promise<{ text: string; sources: Source[] }> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let text = "";
  const sources: Source[] = [];
  // A long web search turn can pause. Send it back so Claude can finish (a few times at most).
  for (let turn = 0; turn < 4; turn++) {
    const msg = await client.messages.create({
      model: opts.model ?? claudeModel(),
      max_tokens: opts.maxTokens ?? 16000,
      messages,
      ...(opts.searches
        ? { tools: [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: opts.searches }] }
        : {}),
    });
    for (const block of msg.content) {
      if (block.type !== "text") continue;
      text += block.text;
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location") sources.push({ url: c.url, title: c.title, domain: "" });
      }
    }
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  return { text, sources };
}

/** Pull the first JSON object out of a reply. */
export function parseJson(text: string): Record<string, unknown> {
  const t = text.replace(/```(?:json)?/g, "");
  return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
}
