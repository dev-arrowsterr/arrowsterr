import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export function claudeModel() {
  return process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
}

/** Ask Claude one question and get the text back. Web search is optional. */
export async function askClaude(prompt: string, opts: { web?: boolean; maxTokens?: number } = {}) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let text = "";
  // A long web search turn can pause. Send it back so Claude can finish (a few times at most).
  for (let turn = 0; turn < 4; turn++) {
    const msg = await client.messages.create({
      model: claudeModel(),
      max_tokens: opts.maxTokens ?? 16000,
      messages,
      ...(opts.web ? { tools: [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: 3 }] } : {}),
    });
    for (const block of msg.content) if (block.type === "text") text += block.text;
    if (msg.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: msg.content });
  }
  return text;
}

/** Pull the first JSON object out of a reply. */
export function parseJson(text: string): Record<string, unknown> {
  const t = text.replace(/```(?:json)?/g, "");
  return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
}
