import "server-only";
import { cleanSources, linksInText, type Source } from "./sources";

// DataForSEO reads the real ChatGPT and Gemini apps and Google's AI Overview for us.
// Live calls answer right away (used by the Run button). Queued tasks are cheaper and
// finish within about 45 minutes (used by the daily job).

export type DfsEngine = "ChatGPT" | "Gemini" | "AI Overview";
export type DfsAnswer = { text: string; sources: Source[] };

const API = process.env.DFS_API_URL?.trim() || "https://api.dataforseo.com/v3";
const PATHS: Record<DfsEngine, string> = {
  ChatGPT: "ai_optimization/chat_gpt/llm_scraper",
  Gemini: "ai_optimization/gemini/llm_scraper",
  "AI Overview": "serp/google/organic",
};
export const NO_AI_OVERVIEW = "_Google showed no AI Overview for this search._";

export const dfsReady = () => Boolean(process.env.DFS_LOGIN?.trim() && process.env.DFS_PASSWORD?.trim());

async function call(path: string, body?: unknown) {
  const auth = Buffer.from(`${process.env.DFS_LOGIN?.trim()}:${process.env.DFS_PASSWORD?.trim()}`).toString("base64");
  const res = await fetch(`${API}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(150_000),
  });
  if (!res.ok) throw new Error(`DataForSEO returned ${res.status}`);
  const data = await res.json();
  if (data?.status_code !== 20000) throw new Error(`DataForSEO: ${data?.status_message ?? "unknown error"}`);
  return data.tasks ?? [];
}

function taskBody(engine: DfsEngine, prompt: string, extra: Record<string, unknown> = {}) {
  const base = {
    keyword: prompt.slice(0, 700),
    location_code: Number(process.env.DFS_LOCATION_CODE) || 2840, // United States
    language_code: process.env.DFS_LANGUAGE_CODE || "en",
    ...extra,
  };
  if (engine === "ChatGPT") return { ...base, force_web_search: true };
  if (engine === "AI Overview") return { ...base, device: "desktop", load_async_ai_overview: true };
  return base;
}

type Raw = { url?: string; domain?: string; title?: string };
const toSources = (list: Raw[] | undefined): Source[] =>
  (list ?? []).filter((s) => s?.url).map((s) => ({ url: s.url!, title: s.title ?? null, domain: s.domain ?? "" }));

type Item = { type?: string; markdown?: string; text?: string; title?: string; sources?: Raw[]; references?: Raw[]; items?: Item[] };

/** Turn one finished task's result into answer text and cited links. */
function read(engine: DfsEngine, result: { markdown?: string; sources?: Raw[]; items?: Item[] } | undefined): DfsAnswer {
  if (engine === "AI Overview") {
    const aio = (result?.items ?? []).find((i) => i.type === "ai_overview");
    if (!aio) return { text: NO_AI_OVERVIEW, sources: [] };
    const text =
      aio.markdown ||
      (aio.items ?? []).map((i) => [i.title ? `## ${i.title}` : "", i.markdown || i.text || ""].filter(Boolean).join("\n")).join("\n\n");
    const refs = [...(aio.references ?? []), ...(aio.items ?? []).flatMap((i) => i.references ?? [])];
    return { text, sources: cleanSources(toSources(refs)) };
  }
  const items = result?.items ?? [];
  const text = (result?.markdown || items.map((i) => i.markdown ?? "").filter(Boolean).join("\n\n")).replace(/\[\d+\]/g, "");
  const sources = [...toSources(result?.sources), ...items.flatMap((i) => toSources(i.sources)), ...linksInText(text)];
  return { text, sources: cleanSources(sources) };
}

/** Ask now and wait for the answer. Costs more than a queued task. */
export async function askLive(engine: DfsEngine, prompt: string): Promise<DfsAnswer> {
  const [task] = await call(`${PATHS[engine]}/live/advanced`, [taskBody(engine, prompt)]);
  if (task?.status_code !== 20000) throw new Error(`DataForSEO: ${task?.status_message ?? "no result"}`);
  return read(engine, task.result?.[0]);
}

/** Queue prompts at the standard (cheaper) price. Returns one task id per prompt, or null when that one failed. */
export async function postTasks(engine: DfsEngine, prompts: string[]): Promise<(string | null)[]> {
  const ids: (string | null)[] = [];
  for (let i = 0; i < prompts.length; i += 100) {
    const chunk = prompts.slice(i, i + 100);
    const tasks = await call(`${PATHS[engine]}/task_post`, chunk.map((p) => taskBody(engine, p, { priority: 1 })));
    chunk.forEach((_, j) => ids.push(tasks[j]?.status_code === 20100 ? tasks[j].id : null));
  }
  return ids;
}

export type TaskState = { state: "waiting" } | { state: "done"; answer: DfsAnswer } | { state: "failed"; error: string };

/** Check one queued task. Reading results is free. */
export async function getTask(engine: DfsEngine, id: string): Promise<TaskState> {
  const [task] = await call(`${PATHS[engine]}/task_get/advanced/${id}`);
  const code = Number(task?.status_code);
  if (code === 20000) return { state: "done", answer: read(engine, task.result?.[0]) };
  if (code >= 40600 && code < 40700) return { state: "waiting" }; // still in the queue
  if (engine === "AI Overview" && code === 40102) return { state: "done", answer: { text: NO_AI_OVERVIEW, sources: [] } };
  return { state: "failed", error: `DataForSEO: ${task?.status_message ?? `status ${code}`}` };
}
