import assert from "node:assert/strict";
import { test } from "node:test";
import { bestEmail, contactLinks, decodeCfEmail, emailsInHtml, rssOwnerEmail, sameShow, sameSite } from "../src/lib/contacts.ts";

test("emailsInHtml: mailto, Cloudflare-protected and plain text, junk left out", () => {
  // Cloudflare: key 0x42 XOR each byte of "hi@acme.com".
  const cf = "42" + [..."hi@acme.com"].map((c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, "0")).join("");
  const html = `
    <a href="mailto:Editor@Acme.com?subject=Hi">Email us</a>
    <span class="__cf_email__" data-cfemail="${cf}">[email protected]</span>
    <p>Write to partners@acme.com, or press [at] acme.com.</p>
    <img src="logo@2x.png"> noreply@acme.com you@example.com name@acme.com
    <script>Sentry.init({dsn:"https://abc@o1.ingest.sentry.io/1"})</script>`;
  assert.deepEqual(emailsInHtml(html), ["editor@acme.com", "hi@acme.com", "partners@acme.com", "press@acme.com"]);
});

test("decodeCfEmail: bad input gives nothing", () => {
  assert.equal(decodeCfEmail("zz"), "");
  assert.equal(decodeCfEmail("123"), "");
});

test("sameSite: same domain, subdomains and parent domain only", () => {
  assert.ok(sameSite("a@acme.com", "www.acme.com"));
  assert.ok(sameSite("a@mail.acme.com", "acme.com"));
  assert.ok(sameSite("a@acme.com", "blog.acme.com"));
  assert.ok(!sameSite("a@acme.co", "acme.com"));
  assert.ok(!sameSite("a@notacme.com", "acme.com"));
});

test("bestEmail: pitch inboxes first, the site's own domain, a personal address only from the contact page", () => {
  const home = { html: "Questions? support@acme.com or hello@acme.com", contact: false };
  const contact = { html: "Pitches: editor@acme.com. Or reach Jane at jane.doe@gmail.com", contact: true };
  assert.deepEqual(bestEmail([home, contact], "acme.com"), { email: "editor@acme.com", source: "contact_page" });
  assert.deepEqual(bestEmail([home], "acme.com"), { email: "hello@acme.com", source: "site" });
  assert.equal(bestEmail([{ html: "Ads by sales@adnetwork.com", contact: false }], "acme.com"), null);
  assert.deepEqual(bestEmail([{ html: "Contact me: jane.doe@gmail.com", contact: true }], "janedoe.blog"), { email: "jane.doe@gmail.com", source: "contact_page" });
});

test("contactLinks: same-site links that lead to contact, about or write-for-us pages", () => {
  const html = `<a href="/contact">Contact</a><a href="https://acme.com/about-us/">About</a><a href="/pricing">Pricing</a>
    <a href="https://twitter.com/acme">Contact on X</a><a href="/blog/x">Write for us</a><a href="#top">About</a>`;
  assert.deepEqual(contactLinks(html, "https://www.acme.com"), ["https://www.acme.com/contact", "https://acme.com/about-us/", "https://www.acme.com/blog/x"]);
});

test("rssOwnerEmail: the iTunes owner first, then the managing editor", () => {
  assert.equal(rssOwnerEmail("<channel><itunes:owner><itunes:name>Show</itunes:name><itunes:email> Hosts@Show.fm </itunes:email></itunes:owner></channel>"), "hosts@show.fm");
  assert.equal(rssOwnerEmail("<managingEditor>editor@show.fm (Jane)</managingEditor>"), "editor@show.fm");
  assert.equal(rssOwnerEmail("<channel><title>No email</title></channel>"), null);
});

test("sameShow: loose but not sloppy podcast name match", () => {
  assert.ok(sameShow("The Growth Show", "Growth Show Podcast"));
  assert.ok(sameShow("Marketing Over Coffee", "Marketing Over Coffee Marketing Podcast"));
  assert.ok(!sameShow("Growth", "The Growth Hacking Podcast for Founders"));
  assert.ok(!sameShow("SaaS Talk", "Sales Talk"));
});

test("rssEpisodes: newest episodes with clean titles and short summaries", async () => {
  const { rssEpisodes } = await import("../src/lib/contacts.ts");
  const xml = `<channel><title>Show</title>
    <item><title><![CDATA[Ep 142: Zero-click search & you]]></title><itunes:summary><p>Where buyers go when Google stops sending clicks.</p></itunes:summary></item>
    <item><title>Ep 141: Notion's growth lead</title><description>How they grew &amp; hired.</description></item>
    <item><title></title></item>
    <item><title>Ep 140</title></item></channel>`;
  assert.deepEqual(rssEpisodes(xml), [
    { title: "Ep 142: Zero-click search & you", summary: "Where buyers go when Google stops sending clicks." },
    { title: "Ep 141: Notion's growth lead", summary: "How they grew & hired." },
  ]);
  assert.deepEqual(rssEpisodes(""), []);
});
