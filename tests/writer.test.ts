import { test } from "node:test";
import assert from "node:assert/strict";
import { drive, runBrief, type BriefDeps, type BriefRow, type BriefStore, type Outcome, type ResearchPack, type WriterBrief, type WriterContext } from "../src/lib/writerBrief.ts";
import { applyCheck, buildDoc, planSections, requestDraft, runDraft, type DraftDeps, type DraftRef, type DraftRow, type DraftStore, type QuotaStore, type Section } from "../src/lib/writerDraft.ts";
import { validateModule, wrapModule } from "../src/lib/writerModules.ts";

// ─────────────── fixtures ───────────────
const pack: ResearchPack = {
  keyword: "crm for startups",
  pages: [
    { url: "https://a.com/crm", title: "CRM guide", domain: "a.com", kind: "serp", position: 1, words: 2000, headings: ["Pricing"], body: "HubSpot has a free plan. Pipedrive starts at $14 a month." },
    { url: "https://b.com/best", title: "Best CRMs", domain: "b.com", kind: "serp", position: 2, words: 1500, headings: [], body: "Attio is built for startups." },
    { url: "https://c.com/ai", title: "AI pick", domain: "c.com", kind: "ai", position: null, words: 900, headings: [], body: "Startups pick tools that grow with them." },
  ],
  questions: [{ question: "What is the cheapest CRM?", answer: null }],
  aiOverview: "",
  answers: [{ engine: "ChatGPT", text: "HubSpot and Pipedrive are common picks.", cited: ["https://a.com/crm"] }],
};
const ctx: WriterContext = { brand: { name: "Acme", domain: "acme.com" }, voice: null, kit: null, guidelines: null, sitemap: ["https://acme.com/pricing"] };

const rawBrief = {
  titles: ["The best CRM for startups"],
  h1: "The best CRM for startups",
  metaDescription: "Pick a CRM.",
  slug: "best-crm-startups",
  searchIntent: "Compare",
  reader: "Founders",
  angle: "Cost over time",
  wordTarget: 1500,
  outline: [
    { h2: "What to look for", points: ["Price"], h3: [], sources: [1, 99] },
    { h2: "The options", points: ["HubSpot", "Pipedrive"], h3: [], sources: [1, 2] },
  ],
  entities: ["HubSpot"],
  gaps: ["Cost after year one"],
  faqs: [{ question: "What is the cheapest CRM?", answer: "Free plans" }],
  internalLinks: [
    { url: "https://acme.com/pricing", anchor: "our pricing", where: "The options" },
    { url: "https://evil.com", anchor: "x", where: "The options" },
  ],
  cta: { text: "Try Acme", where: "The options" },
  modules: [{ type: "calculator", title: "CRM cost calculator", purpose: "Cost", placement: "the options", inputs: ["Seats"], outputs: ["Cost"], data: "", why: "Real numbers" }],
  topPages: "Lists.",
  aiAnswers: "HubSpot.",
};

function briefRow(over: Partial<BriefRow> = {}): BriefRow {
  return { id: "b1", workspace_id: "w1", brand_id: "br1", site_id: "s1", item_id: "i1", keyword: "crm for startups", research_run_id: null, status: "generating", step: "research", brief: null, notes: "", note: null, version: 1, error: null, ...over };
}

function briefMemory(row: BriefRow) {
  const db = { row: structuredClone(row) };
  const store: BriefStore = { brief: async () => structuredClone(db.row), update: async (_id, patch) => void Object.assign(db.row, patch) };
  return { db, store };
}

function briefDeps(status: () => string, calls: { start: number; write: number }): BriefDeps {
  return {
    startResearch: async () => {
      calls.start++;
      return "run1";
    },
    runStatus: async () => ({ status: status(), error: null }),
    research: async () => pack,
    context: async () => ctx,
    write: async () => {
      calls.write++;
      return rawBrief;
    },
    model: "claude-sonnet-5-5",
  };
}

const goodModule = `<div class="awm-root"><label for="awm-seats">Seats</label><input id="awm-seats" type="number" value="5"><p aria-live="polite" id="awm-out"></p></div><style>.awm-root{color:var(--aw-ink)}</style><script>const s=document.getElementById("awm-seats");const o=document.getElementById("awm-out");const f=()=>{o.textContent="$"+(Number(s.value)*14)};s.addEventListener("input",f);f();</script>`;

// ─────────────── the brief ───────────────
test("the brief waits for its research without paying or using up attempts", async () => {
  let status = "reading";
  const calls = { start: 0, write: 0 };
  const { db, store } = briefMemory(briefRow());
  const deps = briefDeps(() => status, calls);
  const job = { id: 7, attempts: 1, max_attempts: 4 };
  const queue: { retries: { seconds: number; count: boolean }[]; finished: number } = { retries: [], finished: 0 };
  const q = {
    finish: async () => void queue.finished++,
    retry: async (_id: number, _why: string, seconds: number, opts: { count: boolean }) => {
      queue.retries.push({ seconds, count: opts.count });
      if (opts.count) job.attempts++; // what retry_job does with p_count
    },
  };
  for (let i = 0; i < 5; i++) await drive(job, q, () => runBrief(store, deps, "b1", 1), async () => {});
  assert.equal(calls.write, 0, "no Claude call while the research runs");
  assert.equal(calls.start, 1, "the research is started once");
  assert.equal(queue.retries.length, 5);
  assert.ok(queue.retries.every((r) => r.count === false && r.seconds >= 30));
  assert.equal(job.attempts, 1, "waiting never uses up an attempt");
  assert.equal(db.row.status, "generating");

  status = "done";
  await drive(job, q, () => runBrief(store, deps, "b1", 1), async () => {});
  assert.equal(calls.write, 1);
  assert.equal(queue.finished, 1);
  assert.equal(db.row.status, "ready");
  const b = db.row.brief!;
  assert.deepEqual(b.outline[0].sources, [1], "a source the research doesn't have is dropped");
  assert.equal(b.modules[0].placement, "The options", "placement matches an H2");
  assert.deepEqual(b.internalLinks.map((l) => l.url), ["https://acme.com/pricing"], "internal links come from the sitemap only");
  assert.equal(b.research.sources.length, 3);

  // A retried job after the brief is saved pays nothing.
  await runBrief(store, deps, "b1", 1);
  assert.equal(calls.write, 1);
});

test("a brief whose research failed fails, and an older version's job stops", async () => {
  const calls = { start: 0, write: 0 };
  const failed = briefMemory(briefRow());
  const out = await runBrief(failed.store, briefDeps(() => "failed", calls), "b1");
  assert.equal(out.state, "failed");
  assert.equal(failed.db.row.status, "failed");

  const newer = briefMemory(briefRow({ version: 2 }));
  assert.deepEqual(await runBrief(newer.store, briefDeps(() => "done", calls), "b1", 1), { state: "done" });
  assert.equal(calls.write, 0);
});

test("a job that keeps throwing marks the brief failed on its last attempt", async () => {
  let marked = "";
  const q = { finish: async () => {}, retry: async () => {} };
  const boom = async (): Promise<Outcome> => {
    throw new Error("Claude is down");
  };
  await assert.rejects(drive({ id: 1, attempts: 1, max_attempts: 3 }, q, boom, async (e) => void (marked = e)));
  assert.equal(marked, "");
  await drive({ id: 1, attempts: 3, max_attempts: 3 }, q, boom, async (e) => void (marked = e));
  assert.equal(marked, "Claude is down");
});

// ─────────────── the draft ───────────────
async function approvedBrief(): Promise<BriefRow> {
  const { db, store } = briefMemory(briefRow());
  await runBrief(store, briefDeps(() => "done", { start: 0, write: 0 }), "b1");
  return { ...db.row, status: "approved" };
}

function draftRow(over: Partial<DraftRow> = {}): DraftRow {
  return { id: "d1", workspace_id: "w1", brand_id: "br1", site_id: "s1", item_id: "i1", brief_id: "b1", doc_id: null, status: "generating", step: "sections", version: 1, note: null, sections: [], checked: null, check_at: null, modules: [], period: "2026-10", words: 0, error: null, ready_at: null, ...over };
}

function draftMemory(brief: BriefRow, row = draftRow()) {
  const db = { row: structuredClone(row), docs: [] as { id: string; content: Record<string, unknown> }[] };
  const store: DraftStore = {
    draft: async () => structuredClone(db.row),
    brief: async () => structuredClone(brief),
    update: async (_id, patch) => void Object.assign(db.row, structuredClone(patch)),
    saveDoc: async (d, doc) => {
      const have = db.docs.find((x) => x.id === d.doc_id);
      if (have) have.content = doc.content;
      else db.docs.push({ id: `doc${db.docs.length + 1}`, content: doc.content });
      return d.doc_id ?? `doc${db.docs.length}`;
    },
  };
  return { db, store };
}

function draftDeps(calls: { section: number; check: number; module: number }, opts: { crashAt?: number; module?: string[] } = {}): DraftDeps {
  return {
    context: async () => ({ ctx, pack }),
    writeSection: async (_p, prompt) => {
      calls.section++;
      if (opts.crashAt !== undefined && calls.section === opts.crashAt) throw new Error("killed");
      return { blocks: [{ type: "p", text: `HubSpot has a free plan [per A](https://a.com/crm). See [this](https://random.org/x). ${prompt.slice(0, 20).replace(/[[\]()*]/g, "")}.`, items: [], rows: [] }] };
    },
    check: async () => {
      calls.check++;
      return { cut: [] };
    },
    buildModule: async () => {
      const html = opts.module?.[calls.module] ?? goodModule;
      calls.module++;
      return { html };
    },
    model: "claude-sonnet-5-5",
  };
}

test("a killed draft job restarts without paying twice for finished sections", async () => {
  const brief = await approvedBrief();
  const sections = planSections(brief.brief!).length; // intro, 2 H2s, FAQ
  assert.equal(sections, 4);
  const calls = { section: 0, check: 0, module: 0 };
  const { db, store } = draftMemory(brief);

  // The worker dies during the third section.
  await assert.rejects(runDraft(store, draftDeps(calls, { crashAt: 3 }), "d1", 1), /killed/);
  assert.equal(db.row.sections.filter(Boolean).length, 2, "the two finished sections were saved");

  const out = await runDraft(store, draftDeps(calls), "d1", 1);
  assert.deepEqual(out, { state: "done" });
  assert.equal(calls.section, sections + 1, "only the section that was cut off is paid again");
  assert.equal(calls.check, 1);
  assert.equal(calls.module, 1);
  assert.equal(db.row.status, "ready");
  assert.equal(db.docs.length, 1);

  // Running the finished job again pays nothing and makes no second doc.
  await runDraft(store, draftDeps(calls), "d1", 1);
  assert.equal(calls.section, sections + 1);
  assert.equal(db.docs.length, 1);

  // The module sits after its H2, and links outside the sources are unlinked.
  const content = (db.docs[0].content as { content: { type: string; attrs?: Record<string, unknown>; content?: { text?: string; marks?: unknown[] }[] }[] }).content;
  const at = content.findIndex((n) => n.type === "heading" && n.content?.[0]?.text === "The options");
  assert.equal(content[at + 2].type, "embed");
  assert.match(String(content[at + 2].attrs?.html), /data-module="calculator"/);
  const linked = JSON.stringify(content);
  assert.ok(linked.includes("https://a.com/crm"));
  assert.ok(!linked.includes("random.org"), "a link that isn't a saved source is removed");
});

test("a draft job stops after its time budget and picks up where it stopped", async () => {
  const brief = await approvedBrief();
  const calls = { section: 0, check: 0, module: 0 };
  const { db, store } = draftMemory(brief);
  let t = 0;
  const deps = { ...draftDeps(calls), now: () => (t += 100_000), budgetMs: 150_000 };
  let turns = 0;
  let out: Outcome = { state: "wait", seconds: 1, why: "" };
  while (out.state === "wait" && turns < 20) {
    out = await runDraft(store, deps, "d1");
    turns++;
  }
  assert.equal(out.state, "done");
  assert.ok(turns > 1);
  assert.equal(calls.section, 4, "every section paid once across turns");
  assert.equal(calls.check, 1);
  assert.equal(db.row.status, "ready");
});

test("a module that fails its checks is retried once, then dropped", async () => {
  const brief = await approvedBrief();
  const calls = { section: 0, check: 0, module: 0 };
  const bad = `<div><button>Go</button><script src="https://cdn.example.com/x.js"></script></div>`;
  const { db, store } = draftMemory(brief);
  await runDraft(store, draftDeps(calls, { module: [bad, bad] }), "d1");
  assert.equal(calls.module, 2);
  assert.equal(db.row.modules[0]?.status, "dropped");
  assert.equal(db.row.status, "ready", "the article still finishes");
  assert.ok(!JSON.stringify(db.docs[0].content).includes('"embed"'));

  // A retry that fixes it is kept.
  const calls2 = { section: 0, check: 0, module: 0 };
  const again = draftMemory(brief);
  await runDraft(again.store, draftDeps(calls2, { module: [bad, goodModule] }), "d1");
  assert.equal(again.db.row.modules[0]?.status, "ok");
  assert.equal(again.db.row.modules[0]?.attempts, 2);
});

test("the check cuts the sentences it names", () => {
  const s: Section[] = [{ key: "h2-0", h2: "Prices", blocks: [{ type: "p", text: "HubSpot is free. Pipedrive costs $99 a month. Pick one.", items: [], rows: [] }] }];
  const out = applyCheck(s, [{ id: "0.0.1", why: "The sources say $14." }], { urls: [], domain: "acme.com" });
  assert.equal(out.sections[0].blocks[0].text, "HubSpot is free. Pick one.");
  const doc = buildDoc({ ...rawBrief, research: { sources: [], questions: [], engines: [], topPages: "", aiAnswers: "" }, model: "", at: "" } as unknown as WriterBrief, out.sections, []);
  assert.equal(doc.words, 5 + 1); // the H2 counts too, as in the editor
});

// ─────────────── modules ───────────────
test("module checks refuse outside scripts and network calls", () => {
  assert.deepEqual(validateModule(goodModule), { ok: true });
  const bad = [
    `<div><button>Go</button><script src="https://cdn.example.com/x.js"></script></div>`,
    `<div><button>Go</button><script>fetch("https://x.com/a")</script></div>`,
    `<div><button>Go</button><script>const r = new XMLHttpRequest();</script></div>`,
    `<div><button>Go</button><script>import("https://x.com/m.js")</script></div>`,
    `<div><button>Go</button><script>localStorage.setItem("a","b")</script></div>`,
    `<div><button onclick="fetch('/x')">Go</button><script>1</script></div>`,
    `<div><button>Go</button><style>@import url(https://fonts.example.com/a.css);</style><script>1</script></div>`,
    `<div><link rel="stylesheet" href="https://x.com/a.css"><button>Go</button><script>1</script></div>`,
    `<div><img src="https://x.com/pixel.gif"><button>Go</button><script>1</script></div>`,
    `<div><button>Go</button><script>const a = ;</script></div>`,
    `<div><button>Go</button><script>alert("hi")</script></div>`,
    `<div><p>No way to interact.</p><script>1</script></div>`,
    `<html><body><button>Go</button><script>1</script></body></html>`,
  ];
  for (const html of bad) assert.equal(validateModule(html).ok, false, html);
  // Prose that mentions these words is fine.
  assert.equal(validateModule(`<div><p>Import your data, then fetch the report.</p><button id="awm-b">Go</button><script>document.getElementById("awm-b").onclick=()=>{}</script></div>`).ok, true);
  assert.match(wrapModule(goodModule, { type: "calculator", title: "Cost" }, null), /--aw-primary:#0943B0/);
});

// ─────────────── the month's drafts ───────────────
function quotaMemory() {
  const db = { drafts: [] as (DraftRef & { item_id: string; brand_id: string | null; period: string })[], edited: new Set<string>() };
  const store: QuotaStore = {
    draftFor: async (itemId) => db.drafts.find((d) => d.item_id === itemId) ?? null,
    editedByHand: async (d) => db.edited.has(d.id),
    take: async (row, limit) => {
      if (db.drafts.some((d) => d.item_id === row.item_id)) return { outcome: "exists", id: db.drafts.find((d) => d.item_id === row.item_id)!.id };
      if (db.drafts.filter((d) => d.brand_id === row.brand_id && d.period === row.period).length >= limit) return { outcome: "full", id: null };
      const id = `d${db.drafts.length + 1}`;
      db.drafts.push({ id, item_id: row.item_id, brand_id: row.brand_id, period: row.period, status: "generating", doc_id: null, ready_at: null, version: 1 });
      return { outcome: "created", id };
    },
    regenerate: async (id) => {
      const d = db.drafts.find((x) => x.id === id)!;
      d.version++;
      d.status = "generating";
      return d.version;
    },
  };
  const counted = (brand: string, period: string) => db.drafts.filter((d) => d.brand_id === brand && d.period === period).length;
  return { db, store, counted };
}

test("the 11th draft in a month is refused, and Regenerate isn't counted", async () => {
  const brief = await approvedBrief();
  const { db, store, counted } = quotaMemory();
  const ask = (item: string, extra: Partial<Parameters<typeof requestDraft>[1]> = {}) => requestDraft(store, { brief: { ...brief, id: `b-${item}`, item_id: item }, limit: 10, period: "2026-10", ...extra });

  for (let i = 1; i <= 10; i++) {
    const r = await ask(`i${i}`);
    assert.ok(r.ok && r.counted, `draft ${i}`);
  }
  const eleventh = await ask("i11");
  assert.equal(eleventh.ok, false);
  assert.equal(!eleventh.ok && eleventh.status, 429);
  assert.equal(counted("br1", "2026-10"), 10);

  // A finished draft is regenerated for free, even with the month full.
  db.drafts[0].status = "ready";
  const again = await ask("i1", { note: "shorter intro" });
  assert.ok(again.ok && !again.counted && again.version === 2);
  assert.equal(counted("br1", "2026-10"), 10);

  // A draft still being written isn't started twice.
  const twice = await ask("i1");
  assert.ok(twice.ok && !twice.started);

  // Next month has room again; another brand has its own 10.
  assert.ok((await ask("i11", { period: "2026-11" })).ok);
  assert.ok((await requestDraft(store, { brief: { ...brief, brand_id: "br2", id: "x", item_id: "j1" }, limit: 10, period: "2026-10" })).ok);
});

test("Regenerate asks before replacing hand edits, and a draft needs an approved brief", async () => {
  const brief = await approvedBrief();
  const { db, store } = quotaMemory();
  const first = await requestDraft(store, { brief, limit: 10, period: "2026-10" });
  assert.ok(first.ok);
  db.drafts[0].status = "ready";
  db.edited.add(db.drafts[0].id);
  const asked = await requestDraft(store, { brief, limit: 10, period: "2026-10" });
  assert.ok(!asked.ok && asked.edited && asked.status === 409);
  assert.equal(db.drafts[0].version, 1, "nothing was replaced");
  const confirmed = await requestDraft(store, { brief, limit: 10, period: "2026-10", confirm: true });
  assert.ok(confirmed.ok && confirmed.version === 2);

  const unapproved = await requestDraft(quotaMemory().store, { brief: { ...brief, status: "ready" }, limit: 10, period: "2026-10" });
  assert.ok(!unapproved.ok && unapproved.status === 409);
  const noPlan = await requestDraft(quotaMemory().store, { brief, limit: 0, period: "2026-10" });
  assert.ok(!noPlan.ok && noPlan.status === 429);
});
