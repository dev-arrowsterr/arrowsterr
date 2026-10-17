import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asQuestion,
  citedToRead,
  cleanRead,
  MIN_PAGES,
  pageUrlOk,
  pickEngines,
  readSerp,
  research,
  robotsAllows,
  vetPage,
  type AnswerRow,
  type Deps,
  type NewPage,
  type PageRow,
  type Run,
  type Serp,
  type SerpRow,
  type Store,
  type VetDeps,
} from "../src/lib/articleResearch.ts";

// ─────────────── an in-memory database with the unique keys of 049 ───────────────
function memory(run: Partial<Run> = {}) {
  const db = {
    run: { id: "r1", workspace_id: "w1", keyword: "best crm for startups", question: null, status: "queued", step: "serp", serp_at: null, organic: [], paa: [], ai_overview: null, engines: null, ai_at: null, rounds: 0, started_at: new Date().toISOString(), ...run } as Run & { error?: string | null },
    serp: [] as SerpRow[],
    answers: [] as AnswerRow[],
    pages: [] as (PageRow & { error?: string | null })[],
  };
  let nextId = 1;
  const fail: Record<string, number> = {}; // method -> calls left before it throws once
  const maybeCrash = (name: string) => {
    if (fail[name] !== undefined && fail[name]-- === 0) throw new Error(`crash in ${name}`);
  };
  const store: Store = {
    run: async () => structuredClone(db.run),
    updateRun: async (_id, patch) => void Object.assign(db.run, patch),
    serpRows: async () => [...db.serp].sort((a, b) => a.position - b.position),
    addSerpRows: async (rows) => {
      maybeCrash("addSerpRows");
      for (const r of rows) if (!db.serp.some((x) => x.position === r.position)) db.serp.push(r);
    },
    answers: async () => structuredClone(db.answers),
    addAnswer: async (row) => {
      maybeCrash("addAnswer");
      if (!db.answers.some((a) => a.engine === row.engine)) db.answers.push(row);
    },
    pages: async () => structuredClone(db.pages),
    addPages: async (rows: NewPage[]) => {
      for (const r of rows) if (!db.pages.some((p) => p.url === r.url)) db.pages.push({ id: nextId++, run_id: r.run_id, url: r.url, source: r.source, status: r.status, skip_reason: r.skip_reason, attempts: 0, locked_until: null, error: r.error });
    },
    updatePages: async (ids, patch) => {
      for (const p of db.pages) if (ids.includes(p.id)) Object.assign(p, patch);
    },
  };
  return { db, store, fail };
}

const organic = (n: number) => Array.from({ length: n }, (_, i) => ({ position: i + 1, url: `https://site${i + 1}.com/crm`, title: `Result ${i + 1}`, snippet: null, domain: `site${i + 1}.com` }));

function deps(over: Partial<Deps> = {}) {
  const calls = { serp: 0, ask: [] as string[] };
  const d: Deps = {
    serp: async () => {
      calls.serp++;
      return { organic: organic(10), paa: [{ question: "Is HubSpot free?", answer: "Yes.", url: null }], aiOverview: { shown: true, text: "AIO", sources: [{ url: "https://g2.com/crm", title: null, domain: "g2.com" }] } } satisfies Serp;
    },
    ask: async (engine) => {
      calls.ask.push(engine);
      return { text: `${engine} says`, sources: [{ url: "https://shared.com/guide", title: null, domain: "" }, { url: `https://${engine.toLowerCase().replace(/\s/g, "")}.com/only`, title: null, domain: "" }] };
    },
    engines: () => ["ChatGPT", "Gemini", "Perplexity", "AI Mode", "Claude", "AI Overview"],
    rateOk: async () => true,
    ...over,
  };
  return { d, calls };
}

// The worker reading: the first n queued pages are read, the rest fail with reason.
function readPages(db: ReturnType<typeof memory>["db"], n: number, reason: "timeout" | "blocked" = "timeout") {
  let read = 0;
  for (const p of db.pages) {
    if (p.status !== "queued") continue;
    p.attempts++;
    if (read++ < n) Object.assign(p, { status: "done" });
    else Object.assign(p, { status: "skipped", skip_reason: reason });
  }
}

test("a job killed after step 1 and restarted never calls the search again", async () => {
  const { db, store, fail } = memory();
  const { d, calls } = deps();
  fail.addSerpRows = 0; // crash right after the search was saved on the run
  await assert.rejects(research(store, d, "r1"), /crash/);
  assert.equal(calls.serp, 1);
  assert.ok(db.run.serp_at);
  assert.equal(db.serp.length, 0);

  const out = await research(store, d, "r1");
  assert.equal(calls.serp, 1, "the restart reuses the saved search");
  assert.equal(db.serp.length, 10, "the top 10 are rebuilt from the run");
  assert.equal(out.state, "wait");
  assert.equal(db.pages.filter((p) => p.source === "serp").length, 10);
  assert.deepEqual(db.run.paa.map((q) => q.question), ["Is HubSpot free?"]);
});

test("a job killed in step 3 asks only the engines still missing", async () => {
  const { db, store, fail } = memory();
  const { d, calls } = deps();
  fail.addAnswer = 2; // AI Overview and ChatGPT are saved, then it crashes saving Gemini
  await assert.rejects(research(store, d, "r1"), /crash/);
  assert.deepEqual(calls.ask, ["ChatGPT", "Gemini"]);
  await research(store, d, "r1");
  assert.deepEqual(calls.ask, ["ChatGPT", "Gemini", "Gemini", "AI Mode", "Perplexity"], "ChatGPT is not asked again");
  assert.equal(calls.serp, 1);
  assert.deepEqual(db.answers.map((a) => a.engine).sort(), ["AI Mode", "AI Overview", "ChatGPT", "Gemini", "Perplexity"]);
  assert.equal(db.run.question, "What are the best crm for startups?");
});

test("a page that times out or blocks the bot is skipped, and the run finishes with 5 or more", async () => {
  const { db, store } = memory();
  const { d, calls } = deps();
  assert.equal((await research(store, d, "r1")).state, "wait");
  readPages(db, 6, "blocked");
  const out = await research(store, d, "r1");
  assert.deepEqual(out, { state: "done" });
  assert.equal(db.run.status, "done");
  assert.equal(db.pages.filter((p) => p.status === "done").length, 6);
  // Finished runs don't call anything again.
  assert.deepEqual(await research(store, d, "r1"), { state: "done" });
  assert.equal(calls.serp, 1);
  assert.equal(calls.ask.length, 4);
});

test("with fewer than 5 pages read the run waits, tries the failed pages again, then fails", async () => {
  const { db, store } = memory();
  const { d } = deps({ serp: async () => ({ organic: organic(6), paa: [], aiOverview: { shown: false, text: "", sources: [] } }), ask: async () => ({ text: "x", sources: [] }) });
  await research(store, d, "r1");
  readPages(db, 2, "timeout");
  const first = await research(store, d, "r1");
  assert.equal(first.state, "wait");
  assert.equal(db.run.status, "waiting");
  assert.equal(db.run.rounds, 1);
  assert.equal(db.pages.filter((p) => p.status === "queued").length, 4, "timed-out pages go back in the queue");
  readPages(db, 1, "timeout");
  assert.equal((await research(store, d, "r1")).state, "wait");
  readPages(db, 0, "timeout");
  const last = await research(store, d, "r1");
  assert.equal(last.state, "failed");
  assert.match(db.run.error ?? "", /Only 3 of 6 pages/);
});

test("a stuck worker's page is given up after its last try", async () => {
  const { db, store } = memory();
  const { d } = deps();
  await research(store, d, "r1");
  const [stuck, ...rest] = db.pages;
  for (const p of rest) Object.assign(p, { status: "done", attempts: 1 });
  Object.assign(stuck, { status: "rendering", attempts: 3, locked_until: new Date(Date.now() - 1000).toISOString() });
  assert.ok(rest.length >= MIN_PAGES);
  await research(store, d, "r1");
  assert.equal(db.pages.find((p) => p.id === stuck.id)!.skip_reason, "timeout");
  assert.equal(db.run.status, "done");
});

test("duplicate cited links are read once, never twice with Google's results, at most 10", () => {
  const answers = [
    { cited: [{ url: "https://www.a.com/x/", title: null, domain: "" }, { url: "https://a.com/x?utm_source=chatgpt.com", title: null, domain: "" }, { url: "https://site1.com/crm#top", title: null, domain: "" }] },
    { cited: [{ url: "https://b.com/y", title: null, domain: "" }, { url: "http://a.com/x", title: null, domain: "" }] },
    { cited: Array.from({ length: 15 }, (_, i) => ({ url: `https://many${i}.com/p`, title: null, domain: "" })) },
  ];
  const out = citedToRead(answers, ["https://site1.com/crm"]);
  assert.equal(out.length, 10);
  assert.equal(out[0], "https://www.a.com/x", "cited by two engines, so first");
  assert.equal(out.filter((u) => u.includes("a.com/x")).length, 1);
  assert.ok(!out.some((u) => u.includes("site1.com")), "already in Google's top 10");
});

test("the research run queues each cited page once", async () => {
  const { db, store } = memory();
  const { d } = deps();
  await research(store, d, "r1");
  const ai = db.pages.filter((p) => p.source === "ai").map((p) => p.url);
  assert.equal(ai.filter((u) => u === "https://shared.com/guide").length, 1);
  assert.equal(new Set(ai).size, ai.length);
  assert.ok(ai.length <= 10);
  assert.ok(ai.includes("https://g2.com/crm"), "AI Overview's links count as AI sources");
});

test("private network addresses are refused", async () => {
  const net: VetDeps = {
    resolve: async (host) => (host === "evil.example.com" ? ["10.0.0.5"] : host === "mixed.example.com" ? ["8.8.8.8", "fdaa::3"] : ["93.184.216.34"]),
    robots: async () => ({ status: 404, body: "" }),
  };
  for (const url of ["http://127.0.0.1/", "http://[::1]/x", "http://169.254.169.254/latest/meta-data", "http://localhost:3000/", "http://app.internal/", "http://user:pw@example.com/", "https://example.com:8443/", "file:///etc/passwd"]) {
    const v = await vetPage(url, net);
    assert.equal(v.ok, false, url);
  }
  assert.deepEqual(await vetPage("https://evil.example.com/a", net), { ok: false, reason: "private", error: "That address points to a private network." });
  assert.equal((await vetPage("https://mixed.example.com/a", net)).ok, false, "one private address is enough to refuse");
  assert.equal((await vetPage("https://example.com/a", net)).ok, true);
  assert.equal(pageUrlOk("http://10.1.2.3/").ok, false);
  assert.equal(pageUrlOk("https://example.com/").ok, true);
});

test("robots.txt: disallowed paths are skipped", async () => {
  const txt = "User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$\n\nUser-agent: BadBot\nDisallow: /";
  assert.equal(robotsAllows(txt, "/private/page"), false);
  assert.equal(robotsAllows(txt, "/private/ok/page"), true, "the longer Allow wins");
  assert.equal(robotsAllows(txt, "/guide.pdf"), false);
  assert.equal(robotsAllows(txt, "/guide.pdf?x=1"), true);
  assert.equal(robotsAllows(txt, "/blog"), true);
  assert.equal(robotsAllows("User-agent: ArrowsterrBot\nDisallow: /\n\nUser-agent: *\nAllow: /", "/blog"), false, "our own group wins over *");
  assert.equal(robotsAllows("User-agent: Googlebot\nUser-agent: *\nDisallow: /x", "/x/y"), false, "grouped agents share rules");
  assert.equal(robotsAllows("", "/anything"), true);

  const net = (status: number, body = "") => ({ resolve: async () => ["93.184.216.34"], robots: async () => ({ status, body }) });
  assert.equal((await vetPage("https://example.com/private/page", net(200, txt))).ok, false);
  assert.deepEqual(await vetPage("https://example.com/private/page", net(200, txt)), { ok: false, reason: "robots", error: "robots.txt asks bots not to read this page." });
  assert.equal((await vetPage("https://example.com/private/page", net(404))).ok, true, "no robots.txt means allowed");
  assert.equal((await vetPage("https://example.com/a", net(503))).ok, false, "a server error means wait");
});

test("readSerp keeps the top 10, People Also Ask and AI Overview", () => {
  const items = [
    { type: "ai_overview", markdown: "CRMs help.", references: [{ url: "https://g2.com/crm", title: "G2" }] },
    { type: "people_also_ask", items: [{ type: "people_also_ask_element", title: "What is a CRM?", expanded_element: [{ type: "people_also_ask_expanded_element", description: "Software.", url: "https://x.com" }] }] },
    ...Array.from({ length: 12 }, (_, i) => ({ type: "organic", rank_group: i + 1, url: `https://s${i}.com/`, title: `T${i}`, description: `D${i}`, domain: `www.s${i}.com` })),
    { type: "organic", url: "https://s0.com" },
  ];
  const s = readSerp({ items });
  assert.equal(s.organic.length, 10);
  assert.deepEqual(s.organic[0], { position: 1, url: "https://s0.com/", title: "T0", snippet: "D0", domain: "s0.com" });
  assert.deepEqual(s.paa, [{ question: "What is a CRM?", answer: "Software.", url: "https://x.com" }]);
  assert.equal(s.aiOverview.shown, true);
  assert.equal(s.aiOverview.sources[0].url, "https://g2.com/crm");
  assert.equal(readSerp(undefined).aiOverview.shown, false);
});

test("keywords become questions, and 4 engines are picked", () => {
  assert.equal(asQuestion("how to choose a crm"), "How to choose a crm?");
  assert.equal(asQuestion("hubspot vs salesforce"), "Which is better, hubspot or salesforce?");
  assert.equal(asQuestion("crm pricing"), "What should I know about crm pricing?");
  assert.deepEqual(pickEngines(["Claude", "AI Overview", "Perplexity", "ChatGPT"]), ["ChatGPT", "Perplexity", "Claude"]);
  assert.equal(pickEngines(["ChatGPT", "Gemini", "AI Mode", "Perplexity", "Claude"]).length, 4);
});

test("what the worker sends is trimmed to what the database keeps", () => {
  const r = cleanRead({ title: "T", headings: [{ level: 9, text: "H" }, { text: "" }], body: "word ".repeat(200), tables: [[["a", 1]]], published_at: "2026-02-01T00:00:00Z", word_count: 5 });
  assert.equal(r.word_count, 200, "counted from the text kept");
  assert.deepEqual(r.headings, [{ level: 6, text: "H" }]);
  assert.deepEqual(r.tables, [[["a", "1"]]]);
  assert.equal(r.published_at, "2026-02-01T00:00:00.000Z");
  assert.equal(cleanRead({ published_at: "not a date" }).published_at, null);
  assert.equal(cleanRead(null).body, "");
});
