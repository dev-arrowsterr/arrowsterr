// Outreach shapes shared by the server and the browser. See docs/outreach.md.
import type { TargetKind } from "./contacts";

export type { TargetKind };
export type OutreachList = { id: string; name: string; brand_id: string | null; created_at: string };
export type TargetStatus = "new" | "drafted" | "scheduled" | "sent" | "replied" | "do_not_contact";
export type OutreachTarget = {
  id: string;
  list_id: string;
  kind: TargetKind;
  name: string;
  url: string | null;
  domain: string | null;
  email: string | null;
  email_source: "contact_page" | "site" | "rss" | "manual" | null;
  email_status: "pending" | "found" | "not_found" | "manual";
  status: TargetStatus;
  added_from: string;
  created_at: string;
  draft_status: "none" | "pending" | "ready" | "failed";
  draft_purpose: string | null;
  draft_note: string | null;
  draft_subject: string | null;
  draft_body: string | null;
  draft_why: string | null;
  draft_error: string | null;
  drafted_at: string | null;
};
/** One thing to add to a list. */
export type NewTarget = { kind: TargetKind; name: string; url: string | null };

export const KIND_LABEL: Record<TargetKind, string> = { website: "Website", press: "Press", podcast: "Podcast", youtube: "YouTube", social: "Social" };
export const STATUS_LABEL: Record<TargetStatus, string> = { new: "New", drafted: "Drafted", scheduled: "Scheduled", sent: "Sent", replied: "Replied", do_not_contact: "Do not contact" };
export const SOURCE_LABEL: Record<NonNullable<OutreachTarget["email_source"]>, string> = { contact_page: "From the contact page", site: "From the website", rss: "From the RSS feed", manual: "Added by hand" };

/** What an email can ask for, by kind of target. `brief` tells the writer what the email is for. */
export type Purpose = { id: string; label: string; kinds: TargetKind[]; brief: string };
export const PURPOSES: Purpose[] = [
  { id: "listicle", label: "Get added to a list or roundup", kinds: ["website"], brief: "Ask them to add our brand to their list, roundup or comparison page. Say in one line why it fits their readers, and offer what makes adding it easy (a short blurb, a screenshot, a free account to test)." },
  { id: "link", label: "Link to one of our pages", kinds: ["website", "press"], brief: "Point out a spot in their article where one of our pages adds something useful for their readers, and suggest it as a source. Be specific about where it fits. Never offer money for links." },
  { id: "guest_post", label: "Guest post", kinds: ["website"], brief: "Pitch a guest post: two or three title ideas that fit their audience and that they have not covered yet." },
  { id: "story", label: "Story pitch", kinds: ["press"], brief: "Pitch a story built on something new: data, a trend or a strong opinion from our team. One-line hook first, then why their readers care now." },
  { id: "expert", label: "Expert quote", kinds: ["press"], brief: "Offer a named person from our team as an expert source for their stories on this topic, with two angles they can speak to." },
  { id: "guest", label: "Guest on the show", kinds: ["podcast", "youtube"], brief: "Pitch our founder or expert as a guest: one episode idea with three talking points their audience would value." },
  { id: "review", label: "Review or feature", kinds: ["youtube", "website", "social"], brief: "Invite them to try the product and review or feature it if they like it. Offer free access. No conditions on what they say." },
  { id: "sponsor", label: "Sponsorship", kinds: ["podcast", "youtube", "social"], brief: "Ask about sponsorship or paid placement: their rates, formats and next open dates." },
  { id: "collab", label: "Collaboration", kinds: ["social", "website", "podcast", "youtube"], brief: "Suggest one concrete collaboration idea that helps their audience, like a joint post, a webinar or shared data." },
  { id: "custom", label: "My own ask", kinds: ["website", "press", "podcast", "youtube", "social"], brief: "Do exactly what the person's note below asks for." },
];
export const purposeOf = (id: string | null | undefined) => PURPOSES.find((p) => p.id === id);

/** Where a target is in the outreach, for the board's columns. */
export const STAGES = [
  { id: "finding", label: "Finding email", cls: "aw-status--pending" },
  { id: "ready", label: "Ready", cls: "aw-chip--brand" },
  { id: "drafted", label: "Drafted", cls: "aw-status--warn" },
  { id: "sent", label: "Sent", cls: "aw-status--pending" },
  { id: "replied", label: "Replied", cls: "aw-status--ranked" },
  { id: "stopped", label: "Do not contact", cls: "aw-status--missed" },
] as const;
export type Stage = (typeof STAGES)[number]["id"];

export function stageOf(t: Pick<OutreachTarget, "status" | "email" | "draft_status">): Stage {
  if (t.status === "do_not_contact") return "stopped";
  if (t.status === "replied") return "replied";
  if (t.status === "sent" || t.status === "scheduled") return "sent";
  if (t.status === "drafted" || t.draft_status === "ready" || t.draft_status === "pending") return "drafted";
  return t.email ? "ready" : "finding";
}
