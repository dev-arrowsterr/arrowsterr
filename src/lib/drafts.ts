import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiContext } from "./aiSettings";
import { askJson, claudeModel } from "./claude";
import { podcastFeed } from "./contactFinder";
import { rssEpisodes } from "./contacts";
import { take } from "./entitlements";
import { finish, rateOk, retry, type Job } from "./jobs";
import { KIND_LABEL, purposeOf, type TargetKind } from "./outreach";
import { TASK_COST } from "./plans";
import { fetchSite } from "./site";

// The draft job: write one outreach email for one target, for the purpose the person picked.
// It reads the target first (the page, or a podcast's latest episodes) so the email is about them.
// Only facts from that reading and the brand's own profile go in. Nothing is sent from here.

type Payload = { targetId: string; sender: string };
type Draft = { subject: string; body: string; why: string };

const SCHEMA = {
  type: "object",
  properties: { subject: { type: "string" }, body: { type: "string" }, why: { type: "string" } },
  required: ["subject", "body", "why"],
  additionalProperties: false,
};

/** What the target publishes, as plain text for the writer. */
async function readTarget(kind: TargetKind, name: string, url: string | null): Promise<string> {
  if (kind === "podcast") {
    const eps = rssEpisodes(await podcastFeed(name));
    if (eps.length) return `Latest episodes:\n${eps.map((e) => `- ${e.title}${e.summary ? `: ${e.summary}` : ""}`).join("\n")}`;
  }
  if (!url) return "";
  const site = await fetchSite(url);
  return [site.title && `Page title: ${site.title}`, site.desc && `Description: ${site.desc}`, site.text && `Page text: ${site.text.slice(0, 5000)}`].filter(Boolean).join("\n");
}

const PROMPT = (o: { brand: string; domain: string; about: string; notes: string; sender: string; kind: TargetKind; name: string; url: string | null; reading: string; brief: string; ask: string }) => `Write a short outreach email from ${o.sender} at ${o.brand} (${o.domain}).

About ${o.brand}:
${o.about || "(no profile yet: keep claims about the product general)"}
${o.notes}

The email goes to: ${o.name} (${KIND_LABEL[o.kind]}${o.url ? `, ${o.url}` : ""}).
What they publish (from their site or feed, read just now):
${o.reading || "(nothing could be read)"}

What the email is for: ${o.brief}
${o.ask ? `The person's note on what to offer or ask: ${o.ask}` : ""}

Rules:
- Open with one specific, true detail from what they publish, so it's clearly written for them. If nothing usable was read, skip that and say so in "why".
- Only use facts given above. No made-up numbers, customers or results.
- One clear ask. 60 to 130 words. Plain words at a 9th grade level. Short paragraphs.
- No em dashes, no hype words, no emoji, no "I hope this finds you well".
- Sign off with ${o.sender} and ${o.brand}.
- The subject is under 8 words, specific to them, and not clickbait.

Return JSON: {"subject": "...", "body": "the email text with line breaks", "why": "one sentence on the detail you used and where it came from"}`;

export async function draft(db: SupabaseClient, job: Job) {
  const p = job.payload as unknown as Payload;
  const { data: t } = await db.from("outreach_targets").select("id, workspace_id, list_id, kind, name, url, draft_purpose, draft_note, draft_status").eq("id", p.targetId).maybeSingle();
  if (!t || t.draft_status !== "pending") return finish(job.id);
  const fail = async (error: string) => {
    await db.from("outreach_targets").update({ draft_status: "failed", draft_error: error }).eq("id", t.id);
    await finish(job.id);
  };
  const purpose = purposeOf(t.draft_purpose);
  if (!purpose) return fail("Pick what the email is for.");
  if (!(await rateOk("anthropic"))) return retry(job.id, "rate limit", 15, { count: false });

  const took = await take(t.workspace_id, "tasks", TASK_COST.draft);
  if (!took.ok) return fail("This month's tasks are used up. Buy a task pack or wait for the reset.");
  try {
    const { data: list } = await db.from("outreach_lists").select("brand_id").eq("id", t.list_id).maybeSingle();
    let q = db.from("brands").select("name, domain, category, profile").eq("workspace_id", t.workspace_id);
    q = list?.brand_id ? q.eq("id", list.brand_id) : q.order("created_at");
    const { data: brands } = await q.limit(1);
    const brand = brands?.[0];
    if (!brand) return fail("Add a brand first.");
    const prof = (brand.profile ?? {}) as { card?: { who?: string[]; howTo?: string[]; whySo?: string[] }; products?: string; features?: string; knowledge?: string };
    const about = [
      brand.category && `Market: ${brand.category}`,
      prof.card?.who?.length && `Who it serves: ${prof.card.who.join("; ")}`,
      prof.card?.howTo?.length && `What it does: ${prof.card.howTo.join("; ")}`,
      prof.card?.whySo?.length && `Why it's different: ${prof.card.whySo.join("; ")}`,
      prof.products && `Products: ${prof.products}`,
      prof.knowledge && `Facts we can use: ${String(prof.knowledge).slice(0, 1500)}`,
    ]
      .filter(Boolean)
      .join("\n");

    const out = await askJson<Draft>(
      PROMPT({ brand: brand.name, domain: brand.domain, about, notes: await aiContext(db, t.workspace_id), sender: p.sender, kind: t.kind, name: t.name, url: t.url, reading: await readTarget(t.kind, t.name, t.url), brief: purpose.brief, ask: t.draft_note ?? "" }),
      SCHEMA,
      { model: claudeModel(), maxTokens: 2000 },
    );
    const subject = String(out.subject ?? "").trim().slice(0, 200);
    const body = String(out.body ?? "").trim().slice(0, 5000);
    if (!subject || !body) throw new Error("The draft came back empty.");
    const { error } = await db
      .from("outreach_targets")
      .update({ draft_status: "ready", draft_subject: subject, draft_body: body, draft_why: String(out.why ?? "").slice(0, 400), draft_error: null, drafted_at: new Date().toISOString() })
      .eq("id", t.id);
    if (error) throw new Error(error.message);
    await db.from("outreach_targets").update({ status: "drafted" }).eq("id", t.id).eq("status", "new");
    await finish(job.id);
  } catch (e) {
    await took.giveBack();
    if (job.attempts + 1 >= job.max_attempts) return fail(e instanceof Error ? e.message : String(e));
    throw e;
  }
}
