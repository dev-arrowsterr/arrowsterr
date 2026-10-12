import type { Lead } from "./lead.ts";
import type { Routed } from "./router.ts";

const REGION_LABEL = {
  us_west: "West Coast",
  us_east: "East Coast",
  emea: "Middle East / Europe",
  apac: "APAC",
  unknown: "Unknown region",
} as const;

export function formatAlert(lead: Lead, r: Routed): string {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";
  const d = r.decision;
  const head =
    r.outcome === "routed"
      ? `:dart: New lead for *${r.ae!.name}* (${REGION_LABEL[r.region]})${d?.icpFit === "maybe" ? " - ICP maybe" : ""}`
      : `:no_entry: Lead not routed (${r.outcome === "not_fit" ? "not ICP" : "rejected"})`;
  const lines = [
    head,
    `*${name}*${lead.jobTitle ? `, ${lead.jobTitle}` : ""} at *${d?.company || lead.company || "?"}*`,
    `${lead.email ?? ""}${lead.phone ? ` · ${lead.phone}` : ""}`,
    [lead.city, lead.state, lead.country].filter(Boolean).join(", "),
  ];
  if (d) {
    lines.push(`> ${d.summary}`);
    if (d.locationCount) lines.push(`Locations: ${d.locationCount}`);
    lines.push(`ICP: ${d.icpFit} - ${d.icpReason}`);
    if (d.redFlags.length) lines.push(`Red flags: ${d.redFlags.join("; ")}`);
  }
  if (r.claudeError) lines.push(`:warning: Claude unavailable, routed on form fields only (${r.claudeError})`);
  lines.push(`_Decided in ${r.ms} ms_`);
  return lines.filter(Boolean).join("\n");
}

export async function notify(lead: Lead, r: Routed): Promise<void> {
  const text = formatAlert(lead, r);
  console.log(JSON.stringify({ event: "lead", outcome: r.outcome, ae: r.ae?.name, region: r.region, email: lead.email, ms: r.ms }));
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Slack returned ${res.status}`);
}
