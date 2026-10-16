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
};
/** One thing to add to a list. */
export type NewTarget = { kind: TargetKind; name: string; url: string | null };

export const KIND_LABEL: Record<TargetKind, string> = { website: "Website", press: "Press", podcast: "Podcast", youtube: "YouTube", social: "Social" };
export const STATUS_LABEL: Record<TargetStatus, string> = { new: "New", drafted: "Drafted", scheduled: "Scheduled", sent: "Sent", replied: "Replied", do_not_contact: "Do not contact" };
export const SOURCE_LABEL: Record<NonNullable<OutreachTarget["email_source"]>, string> = { contact_page: "From the contact page", site: "From the website", rss: "From the RSS feed", manual: "Added by hand" };
