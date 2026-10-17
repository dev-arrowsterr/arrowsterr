import assert from "node:assert/strict";
import { test } from "node:test";
import { articleStatus, docToMarkdown, toArticle } from "../src/lib/articles.ts";

const sent = (live: boolean, at = "2026-10-12T10:00:00Z") => ({ connectionId: "c1", kind: "wordpress" as const, id: "9", url: live ? "https://acme.com/post" : null, live, at });

test("status: published live beats a CMS draft, which beats ready and draft", () => {
  assert.equal(articleStatus(null, null), "Draft");
  assert.equal(articleStatus({ status: "ready" }, null), "Ready");
  assert.equal(articleStatus({ published: [sent(false)] }, null), "CMS draft");
  assert.equal(articleStatus({ published: [sent(false), sent(true)] }, null), "Published");
  assert.equal(articleStatus({}, { status: "published" }), "Published");
});

test("a library row takes the plan's keyword and sources, and the date it went live", () => {
  const base = { id: "d1", site_id: "s1", calendar_item_id: "c1", title: "", words: 1200, updated_at: "2026-10-15T09:00:00Z" };
  const a = toArticle({ ...base, meta: { published: [sent(true)] }, calendar_items: { keyword: "crm for startups", status: "writing", due_date: "2026-10-20", url: null, sources: ["https://a.com", "https://b.com"] } });
  assert.equal(a.title, "Untitled");
  assert.equal(a.keyword, "crm for startups");
  assert.equal(a.status, "Published");
  assert.equal(a.date, "2026-10-12");
  assert.equal(a.sources, 2);
  assert.equal(a.url, "https://acme.com/post");
  // No plan piece: no keyword or sources; the date is the last edit.
  const b = toArticle({ ...base, calendar_item_id: null, calendar_items: null });
  assert.equal(b.keyword, null);
  assert.equal(b.sources, null);
  assert.equal(b.date, "2026-10-15");
  // A plan piece with a date but no brief yet.
  const c = toArticle({ ...base, calendar_items: [{ keyword: "x", status: "planned", due_date: "2026-11-01", url: null, sources: null }] });
  assert.equal(c.date, "2026-11-01");
  assert.equal(c.sources, null);
});

test("markdown export: headings, marks, links, lists, images, tables; notes stay out", () => {
  const t = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });
  const p = (...content: object[]) => ({ type: "paragraph", content });
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [t("Best CRM")] },
      p(t("Plain "), t("bold", [{ type: "bold" }]), t(" and "), t("site", [{ type: "link", attrs: { href: "https://acme.com" } }]), t(" with a_star*")),
      { type: "note", content: [t("A note to the writer")] },
      { type: "bulletList", content: [{ type: "listItem", content: [p(t("One"))] }, { type: "listItem", content: [p(t("Two")), { type: "orderedList", content: [{ type: "listItem", content: [p(t("Sub"))] }] }] }] },
      { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [p(t("Third"))] }] },
      { type: "image", attrs: { src: "https://cdn/x.png", alt: "Chart" } },
      {
        type: "table",
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", content: [p(t("Plan"))] }, { type: "tableHeader", content: [p(t("Price"))] }] },
          { type: "tableRow", content: [{ type: "tableCell", content: [p(t("Pro | Team"))] }, { type: "tableCell", content: [p(t("$9"))] }] },
        ],
      },
      { type: "blockquote", content: [p(t("Quoted"))] },
      p(),
      { type: "embed", attrs: { html: "<div>calc</div>" } },
    ],
  };
  assert.equal(
    docToMarkdown(doc),
    [
      "# Best CRM",
      "Plain **bold** and [site](https://acme.com) with a\\_star\\*",
      "- One\n- Two\n  1. Sub",
      "3. Third",
      "![Chart](https://cdn/x.png)",
      "| Plan | Price |\n| --- | --- |\n| Pro \\| Team | $9 |",
      "> Quoted",
      "<div>calc</div>",
    ].join("\n\n") + "\n",
  );
});
