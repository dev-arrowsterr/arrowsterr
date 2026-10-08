// Sends every prompt to every engine from the browser, a few at a time.
import type { Chat, Run } from "./chats";

const CONCURRENCY = 3; // Few at once keeps the small Render server from running out of memory.

export type RunAuth = { workspaceId: string; token: () => Promise<string> };

/** Error text when the workspace used all its AI answers for today. The run stops when it sees this. */
export const LIMIT_ERROR = "Daily limit reached";

async function askOne(engine: string, prompt: string, brand: string, domain: string, auth: RunAuth, attempt = 0): Promise<Chat> {
  const fail = (error: string): Chat => ({ engine, prompt, text: "", sources: [], brands: [], error });
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth.token()}` },
      body: JSON.stringify({ engine, prompt, brand, domain, workspaceId: auth.workspaceId }),
    });
    const data = await res.json().catch(() => null);
    if (data === null) {
      // Render answered instead of the app: the server restarted or was busy. Try once more.
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 5000));
        return askOne(engine, prompt, brand, domain, auth, 1);
      }
      return fail(`The server returned ${res.status}. Check Render Logs for a crash or out of memory message.`);
    }
    const chat: Chat = { engine, prompt, text: data.text ?? "", sources: data.sources ?? [], brands: data.brands ?? [], error: data.error ?? null };
    if (typeof data.shown === "boolean") chat.shown = data.shown;
    if (Array.isArray(data.organic)) chat.organic = data.organic;
    return chat;
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

export async function runAll(
  brand: { name: string; domain: string; prompts: string[] },
  engines: string[],
  auth: RunAuth,
  onUpdate: (run: Run, done: number, total: number) => void,
): Promise<Run & { limited: boolean }> {
  const jobs = engines.flatMap((engine) => brand.prompts.map((prompt) => ({ engine, prompt })));
  const run: Run = { at: new Date().toISOString(), engines, chats: [] };
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (next < jobs.length && !stopped) {
      const { engine, prompt } = jobs[next++];
      const chat = await askOne(engine, prompt, brand.name, brand.domain, auth);
      // At the daily limit every other chat would fail too, so stop here.
      if (chat.error?.startsWith(LIMIT_ERROR)) {
        stopped = true;
        break;
      }
      run.chats.push(chat);
      onUpdate({ ...run, chats: [...run.chats] }, run.chats.length, jobs.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return { ...run, limited: stopped };
}
