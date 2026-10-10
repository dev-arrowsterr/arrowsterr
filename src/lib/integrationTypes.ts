// Events Arrowsterr sends to webhooks (Zapier and custom tools), shared by the server, the settings page and the docs.

export const EVENTS = {
  "daily.result": "Every day, after a brand's AI answers are checked: its visibility and the change since the last check.",
  "visibility.alert": "When a brand's AI visibility moves by your alert size, or a competitor overtakes it.",
  "brief.ready": "When a content brief is ready.",
  "post.published": "When a draft is published live to a CMS.",
} as const;
export type EventName = keyof typeof EVENTS;

export const SAMPLES: Record<EventName, Record<string, unknown>> = {
  "daily.result": { event: "daily.result", brand: { id: "b_123", name: "Acme", domain: "acme.com" }, day: "2026-10-10", visibility: 46, previous: 41, change: 5, competitors: [{ name: "Rival A", visibility: 38 }, { name: "Rival B", visibility: 27 }] },
  "visibility.alert": { event: "visibility.alert", brand: { id: "b_123", name: "Acme", domain: "acme.com" }, day: "2026-10-10", visibility: 34, previous: 41, change: -7, reasons: ["AI visibility fell 7 points", "Rival A overtook you"] },
  "brief.ready": { event: "brief.ready", brand: { id: "b_123", name: "Acme", domain: "acme.com" }, keyword: "best crm for startups", item_id: "c_123", url: "https://app.arrowsterr.com/editorial-calendar" },
  "post.published": { event: "post.published", title: "Best CRM for startups", url: "https://acme.com/blog/best-crm-for-startups", cms: "wordpress" },
};
