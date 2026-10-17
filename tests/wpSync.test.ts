import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { docToHtml } from "../src/lib/docHtml.ts";
import { collectImages, htmlToBlocks } from "../src/lib/wpConvert.ts";
import { fromBase64, moduleBlock, moduleDocument, readModule, toBase64 } from "../src/lib/wpModules.ts";
import { PublishError, publishToWp, readPost, runScheduled, scheduleKey, statusFor, syncPub, tagIds, versionAtLeast, type Pub, type PubStore, type PublishRequest, type Wp, type WpRes } from "../src/lib/wpSync.ts";

// ─────────────── a fake WordPress site ───────────────
type Post = { id: number; title: string; content: string; status: string; slug: string; date_gmt: string | null; modified_gmt: string; doc?: string; categories?: number[]; tags?: number[]; featured_media?: number; arrowsterr?: Record<string, string> };
function fakeWp(opts: { plugin?: string | null } = {}) {
  const site = {
    posts: new Map<number, Post>(),
    tags: [{ id: 5, name: "CRM &amp; Sales" }] as { id: number; name: string }[],
    modules: new Map<number, unknown[]>(),
    uploads: [] as string[],
    creates: 0,
    updates: 0,
    next: 100,
    clock: 0,
    refuse: false,
    calls: [] as string[],
  };
  const stamp = () => new Date(Date.UTC(2026, 9, 1, 0, 0, site.clock++)).toISOString().slice(0, 19);
  const res = (status: number, data: unknown): WpRes => ({ status, data });
  const view = (p: Post) => ({ id: p.id, link: `https://blog.example.com/${p.slug || p.id}/`, status: p.status, modified_gmt: p.modified_gmt, title: { raw: p.title } });
  const apply = (p: Post, b: Record<string, unknown>) => {
    if (b.title !== undefined) p.title = String(b.title);
    if (b.content !== undefined) p.content = String(b.content);
    if (b.slug !== undefined) p.slug = String(b.slug);
    if (b.status !== undefined) p.status = String(b.status);
    if (b.date_gmt !== undefined) p.date_gmt = String(b.date_gmt);
    if (b.categories) p.categories = b.categories as number[];
    if (b.tags) p.tags = b.tags as number[];
    if (b.featured_media) p.featured_media = Number(b.featured_media);
    if (b.arrowsterr) {
      p.arrowsterr = b.arrowsterr as Record<string, string>;
      if (p.arrowsterr.doc) p.doc = p.arrowsterr.doc;
    }
    p.modified_gmt = stamp();
  };
  const wp: Wp = {
    siteUrl: "https://blog.example.com",
    async req(method, path, body) {
      site.calls.push(`${method} ${path.split("?")[0]}`);
      if (site.refuse) return res(401, { code: "rest_not_logged_in", message: "You are not currently logged in." });
      const [p, q = ""] = path.split("?");
      const qs = new URLSearchParams(q);
      const b = (body ?? {}) as Record<string, unknown>;
      if (p === "/arrowsterr/v1/status") return opts.plugin ? res(200, { version: opts.plugin, seo: "none" }) : res(404, { code: "rest_no_route", message: "No route" });
      if (p === "/arrowsterr/v1/find") {
        if (!opts.plugin) return res(404, { code: "rest_no_route" });
        const hit = [...site.posts.values()].reverse().find((x) => x.doc === qs.get("doc"));
        return res(200, hit ? { id: hit.id, status: hit.status } : { id: null });
      }
      const mm = /^\/arrowsterr\/v1\/posts\/(\d+)\/modules$/.exec(p);
      if (mm) {
        if (!site.posts.has(Number(mm[1]))) return res(404, { code: "rest_post_invalid_id" });
        site.modules.set(Number(mm[1]), b.modules as unknown[]);
        return res(200, { id: Number(mm[1]) });
      }
      if (p === "/wp/v2/posts" && method === "POST") {
        site.creates++;
        const post: Post = { id: site.next++, title: "", content: "", status: "draft", slug: "", date_gmt: null, modified_gmt: "" };
        apply(post, b);
        site.posts.set(post.id, post);
        return res(201, view(post));
      }
      if (p === "/wp/v2/posts" && method === "GET") {
        const s = qs.get("search") ?? "";
        return res(200, [...site.posts.values()].filter((x) => x.status !== "trash" && x.title.includes(s)).map(view));
      }
      const pm = /^\/wp\/v2\/posts\/(\d+)$/.exec(p);
      if (pm) {
        const post = site.posts.get(Number(pm[1]));
        if (!post) return res(404, { code: "rest_post_invalid_id", message: "Invalid post ID." });
        if (method === "GET") return res(200, view(post));
        site.updates++;
        apply(post, b);
        return res(200, view(post));
      }
      if (p === "/wp/v2/tags" && method === "GET") return res(200, site.tags.filter((t) => t.name.toLowerCase().includes((qs.get("search") ?? "").toLowerCase().replace("&", "&amp;")) || t.name.toLowerCase().includes((qs.get("search") ?? "").toLowerCase())));
      if (p === "/wp/v2/tags" && method === "POST") {
        const t = { id: site.next++, name: String(b.name) };
        site.tags.push(t);
        return res(201, t);
      }
      return res(404, { code: "rest_no_route" });
    },
    async upload(src) {
      site.uploads.push(src);
      if (src.includes("broken")) return null;
      return { id: site.next++, url: `https://blog.example.com/wp-content/uploads/${site.uploads.length}.png` };
    },
  };
  return { wp, site };
}

// ─────────────── the doc_publications table, in memory, with its unique key and lock ───────────────
function memStore(clock = () => Date.now()) {
  const rows = new Map<string, Pub & { locked_until?: string | null }>();
  let n = 0;
  const failNext: { field?: keyof Pub } = {};
  const store: PubStore & { rows: typeof rows; failNext: typeof failNext } = {
    rows,
    failNext,
    get: async (d, c) => [...rows.values()].find((r) => r.doc_id === d && r.connection_id === c) ?? null,
    byId: async (id) => rows.get(id) ?? null,
    ensure: async (row) => {
      const have = [...rows.values()].find((r) => r.doc_id === row.doc_id && r.connection_id === row.connection_id);
      if (have) return have;
      const pub: Pub = { id: `p${++n}`, ...row, remote_id: null, url: null, remote_status: null, remote_modified: null, pushed_modified: null, mode: null, scheduled_for: null, options: {}, media: {}, creating_since: null, last_error: null, pushed_at: null, synced_at: null };
      rows.set(pub.id, pub);
      return pub;
    },
    lock: async (id, seconds) => {
      const r = rows.get(id)!;
      if (r.locked_until && Date.parse(r.locked_until) > clock()) return false;
      r.locked_until = new Date(clock() + seconds * 1000).toISOString();
      return true;
    },
    update: async (id, patch) => {
      if (failNext.field && failNext.field in patch && (patch as Record<string, unknown>)[failNext.field]) {
        delete failNext.field;
        throw new Error("database went away");
      }
      Object.assign(rows.get(id)!, patch);
    },
  };
  return store;
}

const DOC = "0b5e6f1a-1111-4222-8333-944455556666";
const req = (over: Partial<PublishRequest> = {}): PublishRequest => ({ workspaceId: "w1", docId: DOC, connectionId: "c1", title: "Best CRM for startups", html: "<h2>Why</h2><p>Because.</p>", mode: "draft", options: { slug: "best-crm" }, ...over });
const calc = moduleBlock({ id: "roi-calc", title: 'ROI "calculator"', html: `<style>b{color:red}</style><script>if (1 < 2 && "x") document.body.dataset.ok = "</iframe><!-- /wp:html -->"</script><b>Tom &amp; Jerry é</b>` });

// ─────────────── converter ───────────────
test("converter: headings, paragraphs, nested lists, tables and images become WordPress blocks", () => {
  const html = `<h1>Best CRM for startups</h1><h2>Intro</h2><h3>Detail <em>here</em></h3><p>Hello <a href="https://x.com" onclick="steal()">x</a> &amp; <a href="javascript:alert(1)">y</a></p><p></p>
<ul><li><p>one</p><ul><li><p>sub</p></li></ul></li><li><p>two</p></li></ul><ol><li><p>first</p></li></ol>
<table><tbody><tr><th><p>Tool</p></th><th><p>Price</p></th></tr><tr><td><p>A</p></td><td colspan="2"><p>$5</p></td></tr></tbody></table>
<p><img src="https://cdn.x.com/a.png" alt="Chart"></p><figure><img src="https://cdn.x.com/b.png" alt=""><figcaption>Caption</figcaption></figure><blockquote><p>Quoted</p></blockquote><pre><code>a < b</code></pre><hr><aside data-note>note to self</aside>`;
  assert.deepEqual(collectImages(html), ["https://cdn.x.com/a.png", "https://cdn.x.com/b.png"]);
  const { content, modules } = htmlToBlocks(html, { plugin: true, title: "Best CRM for Startups", media: { "https://cdn.x.com/a.png": { id: 7, url: "https://blog.example.com/a.png" } } });
  assert.equal(modules.length, 0);
  assert.ok(!content.includes("<h1"), "the h1 that repeats the title is dropped");
  assert.match(content, /<!-- wp:heading -->\n<h2 class="wp-block-heading">Intro<\/h2>\n<!-- \/wp:heading -->/);
  assert.match(content, /<!-- wp:heading \{"level":3\} -->\n<h3 class="wp-block-heading">Detail <em>here<\/em><\/h3>/);
  assert.match(content, /<!-- wp:paragraph -->\n<p>Hello <a href="https:\/\/x.com">x<\/a> &amp; <a>y<\/a><\/p>/);
  assert.ok(!/onclick|javascript:/.test(content));
  assert.equal((content.match(/<!-- wp:paragraph -->/g) ?? []).length, 2, "the empty paragraph is dropped; one in the quote");
  assert.match(content, /<!-- wp:list -->\n<ul class="wp-block-list"><!-- wp:list-item -->\n<li>one\n<!-- wp:list -->\n<ul class="wp-block-list"><!-- wp:list-item -->\n<li>sub<\/li>/);
  assert.match(content, /<!-- wp:list \{"ordered":true\} -->\n<ol class="wp-block-list"><!-- wp:list-item -->\n<li>first<\/li>/);
  assert.match(content, /<!-- wp:table -->\n<figure class="wp-block-table"><table class="has-fixed-layout"><thead><tr><th>Tool<\/th><th>Price<\/th><\/tr><\/thead><tbody><tr><td>A<\/td><td colspan="2">\$5<\/td><\/tr><\/tbody><\/table><\/figure>/);
  assert.match(content, /<!-- wp:image \{"id":7,"sizeSlug":"large","linkDestination":"none"\} -->\n<figure class="wp-block-image size-large"><img src="https:\/\/blog.example.com\/a.png" alt="Chart" class="wp-image-7"\/><\/figure>/);
  assert.match(content, /<figure class="wp-block-image"><img src="https:\/\/cdn.x.com\/b.png" alt=""\/><figcaption class="wp-element-caption">Caption<\/figcaption><\/figure>/);
  assert.match(content, /<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>Quoted<\/p>/);
  assert.match(content, /<!-- wp:code -->\n<pre class="wp-block-code"><code>a &lt; b<\/code><\/pre>/);
  assert.match(content, /<!-- wp:separator -->/);
  assert.ok(!content.includes("note to self"));
  // Every block that opens closes.
  const opens = (content.match(/<!-- wp:([a-z-]+)/g) ?? []).length;
  const closes = (content.match(/<!-- \/wp:([a-z-]+)/g) ?? []).length;
  assert.equal(opens, closes);
});

test("module contract: base64 UTF-8 round trip, and the older embed is read too", () => {
  const html = '<p>é ✓ "quotes"</p>';
  assert.equal(fromBase64(toBase64(html)), html);
  assert.equal(fromBase64("not base64!"), null);
  const { document } = parseHTML(`<html><body>${moduleBlock({ id: "q1", title: "Quiz", html, height: 420 })}<div data-embed="${encodeURIComponent("<b>old</b>")}"></div></body></html>`);
  const [a, b] = Array.from(document.querySelectorAll("div")) as unknown as { getAttribute(n: string): string | null }[];
  assert.deepEqual(readModule((n) => a.getAttribute(n)), { id: "q1", title: "Quiz", html, height: 420 });
  const old = readModule((n) => b.getAttribute(n))!;
  assert.equal(old.html, "<b>old</b>");
  assert.match(old.id, /^m[a-z0-9]+$/);
  assert.throws(() => moduleBlock({ id: "bad id", html }));
});

test("modules: the plugin's shortcode with the HTML sent apart, or an escaped sandboxed iframe without it", () => {
  const html = `<p>Before</p>${calc}<p>After</p>${calc}<div data-aw-module="broken" data-aw-src="%%%"></div>`;
  const withPlugin = htmlToBlocks(html, { plugin: true });
  assert.match(withPlugin.content, /<!-- wp:shortcode -->\n\[arrowsterr_module id="roi-calc"\]\n<!-- \/wp:shortcode -->/);
  assert.match(withPlugin.content, /\[arrowsterr_module id="roi-calc-2"\]/, "a repeated id gets its own");
  assert.deepEqual(withPlugin.modules.map((m) => m.id), ["roi-calc", "roi-calc-2"]);
  assert.ok(withPlugin.modules[0].html.includes("<script>"), "the module keeps its own code for its sandbox");
  assert.ok(!withPlugin.content.includes("broken") && !withPlugin.content.includes("%%%"), "a broken module is dropped, never shown raw");

  const fallback = htmlToBlocks(html, { plugin: false });
  const frames = [...fallback.content.matchAll(/<iframe [^>]*srcdoc="([^"]*)"><\/iframe>/g)];
  assert.equal(frames.length, 2);
  const src = frames[0][1];
  // Nothing in the attribute can end it, close the tag or the block.
  assert.ok(!/[<>"]/.test(src));
  assert.ok(!src.includes("<!--") && !src.includes("-->"));
  assert.ok(!fallback.content.includes("<script>"), "no script runs on the page itself");
  assert.match(fallback.content, /sandbox="allow-scripts"/);
  assert.ok(!/allow-same-origin/.test(fallback.content));
  assert.match(fallback.content, /height:600px/);
  assert.match(fallback.content, /title="ROI &quot;calculator&quot;"/);
  // The browser decodes the attribute back to the module exactly.
  const { document } = parseHTML(`<html><body>${fallback.content}</body></html>`);
  const frame = document.querySelector("iframe") as unknown as { getAttribute(n: string): string };
  assert.equal(frame.getAttribute("srcdoc"), moduleDocument(withPlugin.modules[0].html));
  // The block parser sees exactly one html block per module (the escaped "<!-- /wp:html -->" inside doesn't count).
  assert.equal((fallback.content.match(/<!-- \/wp:html -->/g) ?? []).length, 2);
});

test("docToHtml: a saved draft renders on the server, with modules in the contract", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Costs <2026>" }] },
      { type: "paragraph", content: [{ type: "text", text: "Read ", marks: [{ type: "bold" }] }, { type: "text", text: "this", marks: [{ type: "link", attrs: { href: "javascript:x" } }] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "H" }] }] }] }] },
      { type: "image", attrs: { src: "https://cdn.x.com/i.png", alt: "I" } },
      { type: "awModule", attrs: { id: "calc", title: "Calc", html: "<b>hi</b>" } },
      { type: "embed", attrs: { html: "<i>old</i>" } },
      { type: "note", content: [{ type: "text", text: "secret" }] },
    ],
  };
  const html = docToHtml(doc);
  assert.match(html, /<h2>Costs &lt;2026&gt;<\/h2>/);
  assert.match(html, /<strong>Read <\/strong>this/);
  assert.ok(!html.includes("javascript:") && !html.includes("secret"));
  const { content, modules } = htmlToBlocks(html, { plugin: true });
  assert.deepEqual(modules.map((m) => [m.id, m.html]), [["calc", "<b>hi</b>"], [modules[1].id, "<i>old</i>"]]);
  assert.match(content, /wp:table/);
  assert.match(content, /wp:image/);
  assert.equal(docToHtml(null), "");
});

// ─────────────── publishing ───────────────
test("publishing again updates the same post, never a second one", async () => {
  const { wp, site } = fakeWp({ plugin: "1.1.0" });
  const store = memStore();
  const a = await publishToWp(wp, store, req({ html: `<p>v1</p><p><img src="https://cdn.x.com/a.png" alt="A"></p>${calc}`, options: { slug: "best-crm", image: "https://cdn.x.com/hero.png", tags: ["crm & sales", "Startups"], categoryId: 3, metaTitle: "Best CRM", metaDescription: "Desc" } }));
  assert.equal(a.created, true);
  assert.equal(site.creates, 1);
  const post = site.posts.get(Number(a.pub.remote_id))!;
  assert.equal(post.status, "draft");
  assert.equal(post.doc, DOC, "the plugin tags the post with the article");
  assert.deepEqual(post.categories, [3]);
  assert.equal(post.tags?.[0], 5, "an existing tag is reused (HTML-escaped name)");
  assert.equal(post.tags?.length, 2);
  assert.equal(post.arrowsterr?.title, "Best CRM");
  assert.ok(post.featured_media);
  assert.match(post.content, /\[arrowsterr_module id="roi-calc"\]/);
  assert.equal((site.modules.get(post.id) as { id: string }[])[0].id, "roi-calc");

  const b = await publishToWp(wp, store, req({ html: `<p>v2</p><p><img src="https://cdn.x.com/a.png" alt="A"></p>`, mode: "publish", options: { slug: "best-crm", image: "https://cdn.x.com/hero.png" } }));
  assert.equal(b.created, false);
  assert.equal(b.pub.remote_id, a.pub.remote_id);
  assert.equal(site.creates, 1);
  assert.equal(site.posts.size, 1);
  assert.equal(post.status, "publish");
  assert.match(post.content, /v2/);
  assert.equal(site.uploads.length, 2, "images upload once, not again on the second publish");
  assert.equal(b.pub.remote_status, "publish");
  assert.equal(b.pub.url, "https://blog.example.com/best-crm/");
});

test("two publishes at once: one runs, the other is told to wait; one post", async () => {
  const { wp, site } = fakeWp();
  const store = memStore();
  const out = await Promise.allSettled([publishToWp(wp, store, req()), publishToWp(wp, store, req())]);
  assert.equal(out.filter((o) => o.status === "fulfilled").length, 1);
  const rejected = out.find((o) => o.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof PublishError && rejected.reason.code === "busy");
  assert.equal(site.creates, 1);
  // The lock is let go afterwards.
  await publishToWp(wp, store, req());
  assert.equal(site.creates, 1);
});

test("a publish cut off after WordPress made the post finds it again (plugin tag, or title without the plugin)", async () => {
  for (const plugin of ["1.1.0", null]) {
    const { wp, site } = fakeWp({ plugin });
    const store = memStore();
    store.failNext.field = "remote_id"; // the database fails right after WordPress made the post
    await assert.rejects(publishToWp(wp, store, req()));
    assert.equal(site.creates, 1);
    const pub = [...store.rows.values()][0];
    assert.equal(pub.remote_id, null);
    pub.locked_until = null;
    const again = await publishToWp(wp, store, req({ html: "<p>retry</p>" }));
    assert.equal(site.creates, 1, `no second post (plugin ${plugin})`);
    assert.equal(again.created, false);
    assert.match([...site.posts.values()][0].content, /retry/);
  }
});

test("deleted in WordPress: shows as deleted, refuses to update, and publishes as new only when asked", async () => {
  const { wp, site } = fakeWp();
  const store = memStore();
  const a = await publishToWp(wp, store, req({ mode: "publish" }));
  // Someone without access is not a deletion.
  site.refuse = true;
  await assert.rejects(syncPub(wp, store, a.pub), (e: unknown) => e instanceof PublishError && e.code === "auth");
  assert.equal((await store.byId(a.pub.id))!.remote_status, "publish");
  site.refuse = false;

  site.posts.clear();
  const synced = await syncPub(wp, store, (await store.byId(a.pub.id))!);
  assert.equal(synced.remote_status, "deleted");
  assert.equal((await readPost(wp, a.pub.remote_id!)).status, "deleted");
  await assert.rejects(publishToWp(wp, store, req()), (e: unknown) => e instanceof PublishError && e.code === "deleted");
  assert.equal(site.creates, 1);
  const fresh = await publishToWp(wp, store, req({ asNew: true }));
  assert.equal(site.creates, 2);
  assert.notEqual(fresh.pub.remote_id, a.pub.remote_id);
  assert.equal(fresh.pub.remote_status, "draft");
});

test("deleted between sync and publish: the update notices, and nothing new is made", async () => {
  const { wp, site } = fakeWp();
  const store = memStore();
  await publishToWp(wp, store, req());
  site.posts.clear();
  await assert.rejects(publishToWp(wp, store, req()), (e: unknown) => e instanceof PublishError && e.code === "deleted");
  assert.equal(site.creates, 1);
  assert.equal([...store.rows.values()][0].remote_status, "deleted");
});

test("an edit in WordPress shows on sync; trash counts as gone", async () => {
  const { wp, site } = fakeWp();
  const store = memStore();
  const a = await publishToWp(wp, store, req());
  const post = site.posts.get(Number(a.pub.remote_id))!;
  post.modified_gmt = "2026-12-01T00:00:00";
  const s = await syncPub(wp, store, a.pub);
  assert.ok(s.remote_modified! > s.pushed_modified!);
  post.status = "trash";
  assert.equal((await syncPub(wp, store, s)).remote_status, "trash");
  await assert.rejects(publishToWp(wp, store, req()), (e: unknown) => e instanceof PublishError && e.code === "deleted");
});

test("tags: existing ones are reused and missing ones made", async () => {
  const { wp, site } = fakeWp();
  const ids = await tagIds(wp, ["CRM & Sales", "New tag", "new tag", " "]);
  assert.equal(ids[0], 5);
  assert.equal(ids.length, 2);
  assert.equal(site.tags.length, 2);
});

test("status: draft, publish, future at a date; a date already past publishes now", () => {
  const now = new Date("2026-10-17T10:00:00Z");
  assert.deepEqual(statusFor("draft", null, now), { status: "draft" });
  assert.deepEqual(statusFor("publish", null, now), { status: "publish" });
  assert.deepEqual(statusFor("schedule", "2026-10-20T09:00:00.000Z", now), { status: "future", date_gmt: "2026-10-20T09:00:00" });
  assert.deepEqual(statusFor("schedule", "2026-10-17T09:00:00Z", now), { status: "publish" });
  assert.ok(versionAtLeast("1.10.0", "1.9.2") && versionAtLeast("1.1.0", "1.1.0") && !versionAtLeast("1.0.0", "1.1.0") && !versionAtLeast("", "1.1.0"));
  assert.equal(scheduleKey("p1", "2026-10-20T09:00:00Z"), scheduleKey("p1", "2026-10-20T09:00:00.000Z"));
});

// ─────────────── the wp_publish job ───────────────
const AT = "2026-10-20T09:00:00.000Z";
const before = new Date("2026-10-17T10:00:00Z");
const after = new Date("2026-10-20T09:02:00Z");

test("scheduled: WordPress missed its schedule; the job publishes once, and running it again does nothing", async () => {
  const { wp, site } = fakeWp();
  const store = memStore(() => after.getTime());
  const a = await publishToWp(wp, store, req({ mode: "schedule", scheduleAt: AT }), before);
  const post = site.posts.get(Number(a.pub.remote_id))!;
  assert.equal(post.status, "future");
  assert.equal(post.date_gmt, "2026-10-20T09:00:00");
  const doc = async () => ({ title: "Best CRM for startups", html: "<p>saved</p>", updatedAt: "2026-10-17T09:59:00Z" });
  const runs = await Promise.all([runScheduled({ wp, store, doc }, { pubId: a.pub.id, at: AT }, after), runScheduled({ wp, store, doc }, { pubId: a.pub.id, at: AT }, after)]);
  assert.ok(runs.includes("published"));
  assert.equal(post.status, "publish");
  assert.equal(site.creates, 1);
  assert.equal(await runScheduled({ wp, store, doc }, { pubId: a.pub.id, at: AT }, after), "stale");
  assert.equal(site.creates, 1);
  assert.equal(site.posts.size, 1);
});

test("scheduled: WordPress already published it and nothing changed; the job leaves it", async () => {
  const { wp, site } = fakeWp();
  const store = memStore(() => after.getTime());
  const a = await publishToWp(wp, store, req({ mode: "schedule", scheduleAt: AT }), before);
  site.posts.get(Number(a.pub.remote_id))!.status = "publish"; // WordPress's own schedule ran
  const updates = site.updates;
  const doc = async () => ({ title: "T", html: "<p>x</p>", updatedAt: "2026-10-17T09:00:00Z" });
  assert.equal(await runScheduled({ wp, store, doc }, { pubId: a.pub.id, at: AT }, after), "unchanged");
  assert.equal(site.updates, updates);
  assert.equal(await runScheduled({ wp, store, doc }, { pubId: a.pub.id, at: AT }, after), "stale");
});

test("scheduled: the article changed after scheduling; the job sends the new version live, same post", async () => {
  const { wp, site } = fakeWp({ plugin: "1.1.0" });
  const store = memStore(() => after.getTime());
  const a = await publishToWp(wp, store, req({ mode: "schedule", scheduleAt: AT, html: "<p>old</p>" }), before);
  const doc = async () => ({ title: "Best CRM for startups (updated)", html: `<p>new words</p>${calc}`, updatedAt: "2026-10-19T12:00:00Z" });
  assert.equal(await runScheduled({ wp, store, doc }, { pubId: a.pub.id, at: AT }, after), "updated");
  const post = site.posts.get(Number(a.pub.remote_id))!;
  assert.equal(post.status, "publish");
  assert.match(post.content, /new words/);
  assert.match(post.content, /arrowsterr_module/);
  assert.equal(post.title, "Best CRM for startups (updated)");
  assert.equal(site.creates, 1);
  assert.equal(await runScheduled({ wp, store, doc }, { pubId: a.pub.id, at: AT }, after), "stale");
  assert.equal(site.creates, 1);
});

test("scheduled: a changed, cleared or deleted schedule never publishes or makes a post", async () => {
  const { wp, site } = fakeWp();
  const store = memStore(() => after.getTime());
  const a = await publishToWp(wp, store, req({ mode: "schedule", scheduleAt: AT }), before);
  const doc = async () => ({ title: "T", html: "<p>x</p>", updatedAt: "2026-10-19T12:00:00Z" });
  // Moved to another date: the old job is stale.
  await publishToWp(wp, store, req({ mode: "schedule", scheduleAt: "2026-10-25T09:00:00.000Z" }), before);
  assert.equal(await runScheduled({ wp, store, doc }, { pubId: a.pub.id, at: AT }, after), "stale");
  // Deleted in WordPress before the date: the job never makes a new one.
  site.posts.clear();
  assert.equal(await runScheduled({ wp, store, doc }, { pubId: a.pub.id, at: "2026-10-25T09:00:00.000Z" }, new Date("2026-10-25T09:05:00Z")), "gone");
  assert.equal(site.creates, 1);
  // Edited by hand in WordPress and set to draft there: left alone.
  const { wp: wp2, site: site2 } = fakeWp();
  const store2 = memStore(() => after.getTime());
  const b = await publishToWp(wp2, store2, req({ mode: "schedule", scheduleAt: AT }), before);
  const p2 = site2.posts.get(Number(b.pub.remote_id))!;
  p2.status = "draft";
  p2.modified_gmt = "2026-10-19T00:00:00";
  assert.equal(await runScheduled({ wp: wp2, store: store2, doc }, { pubId: b.pub.id, at: AT }, after), "edited");
  assert.equal(p2.status, "draft");
});

test("scheduled: an article that never reached the site is made once, even with two runs", async () => {
  const { wp, site } = fakeWp();
  const store = memStore(() => after.getTime());
  const pub = await store.ensure({ workspace_id: "w1", doc_id: DOC, connection_id: "c1" });
  await store.update(pub.id, { mode: "schedule", scheduled_for: AT, options: { slug: "x" } });
  const doc = async () => ({ title: "T", html: "<p>x</p>", updatedAt: "2026-10-19T12:00:00Z" });
  const runs = await Promise.all([runScheduled({ wp, store, doc }, { pubId: pub.id, at: AT }, after), runScheduled({ wp, store, doc }, { pubId: pub.id, at: AT }, after)]);
  assert.deepEqual(runs.sort(), ["busy", "published"]);
  assert.equal(site.creates, 1);
  assert.equal([...site.posts.values()][0].status, "publish");
  assert.equal(await runScheduled({ wp, store, doc }, { pubId: pub.id, at: AT }, after), "stale");
  assert.equal(site.creates, 1);
});
