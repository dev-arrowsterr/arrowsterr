// CMS publishing, shared by the server and the browser. Secrets never come back to the browser.

export type CmsKind = "wordpress" | "webflow" | "shopify" | "hubspot" | "ghost";
export type CmsConnection = { id: string; kind: CmsKind; name: string; created_at: string };

export type CmsField = { id: string; label: string; placeholder: string; secret?: boolean; optional?: boolean };
export const CMS: { id: CmsKind; label: string; help: string; fields: CmsField[] }[] = [
  {
    id: "wordpress",
    label: "WordPress",
    help: "In WordPress, open Users → Profile → Application Passwords, add one named Arrowsterr and paste it here.",
    fields: [
      { id: "siteUrl", label: "Site address", placeholder: "https://example.com" },
      { id: "username", label: "Username", placeholder: "admin" },
      { id: "appPassword", label: "Application password", placeholder: "abcd efgh ijkl mnop qrst uvwx", secret: true },
    ],
  },
  {
    id: "webflow",
    label: "Webflow",
    help: "In Webflow, open Site settings → Apps & integrations → API access and make a token with CMS read and write. The collection ID is in the CMS collection's settings.",
    fields: [
      { id: "token", label: "API token", placeholder: "", secret: true },
      { id: "collectionId", label: "Blog collection ID", placeholder: "64f1c2..." },
      { id: "bodyField", label: "Rich text field slug", placeholder: "post-body", optional: true },
      { id: "summaryField", label: "Summary field slug", placeholder: "post-summary", optional: true },
      { id: "imageField", label: "Image field slug", placeholder: "main-image", optional: true },
    ],
  },
  {
    id: "shopify",
    label: "Shopify blog",
    help: "In Shopify, open Settings → Apps → Develop apps, make an app with write_content access and paste its Admin API token. The blog ID is in the blog's URL in your admin.",
    fields: [
      { id: "shop", label: "Store address", placeholder: "your-store.myshopify.com" },
      { id: "token", label: "Admin API token", placeholder: "shpat_...", secret: true },
      { id: "blogId", label: "Blog ID", placeholder: "84512345678" },
    ],
  },
  {
    id: "hubspot",
    label: "HubSpot",
    help: "In HubSpot, open Settings → Integrations → Private apps, make an app with the content scope and paste its token. The blog ID is in the blog's settings URL.",
    fields: [
      { id: "token", label: "Private app token", placeholder: "pat-...", secret: true },
      { id: "blogId", label: "Blog ID", placeholder: "12345678901" },
    ],
  },
  {
    id: "ghost",
    label: "Ghost",
    help: "In Ghost, open Settings → Integrations → Add custom integration and paste its Admin API key and API URL.",
    fields: [
      { id: "siteUrl", label: "API URL", placeholder: "https://example.ghost.io" },
      { id: "adminKey", label: "Admin API key", placeholder: "64f1...:a1b2...", secret: true },
    ],
  },
];

export type PublishInput = { title: string; html: string; slug: string; description: string; image: string; schema: string; live: boolean };
export type Published = { connectionId: string; kind: CmsKind; id: string; url: string | null; live: boolean; at: string };
