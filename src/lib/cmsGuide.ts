// Click-by-click steps for connecting each CMS, shown in Zippie's connect wizard.
// open() builds a link straight to the right admin screen once the person has typed their site address.
import type { CmsKind } from "./cmsTypes";

const site = (v: string | undefined) => {
  const s = (v ?? "").trim().replace(/\/+$/, "");
  if (!s) return "";
  return /^https?:\/\//.test(s) ? s : `https://${s}`;
};

export type CmsGuide = { blurb: string; steps: string[]; open: (form: Record<string, string>) => { label: string; href: string } | null };

export const CMS_GUIDE: Record<CmsKind, CmsGuide> = {
  wordpress: {
    blurb: "Zippie needs an application password. It only works through the WordPress API and you can delete it any time.",
    steps: [
      "Type your site address below, then click Open WordPress.",
      "Scroll to Application Passwords at the bottom of your profile.",
      "Type Arrowsterr as the name and click Add New Application Password.",
      "Copy the password WordPress shows and paste it below, with your WordPress username.",
    ],
    open: (f) => (site(f.siteUrl) ? { label: "Open WordPress", href: `${site(f.siteUrl)}/wp-admin/profile.php#application-passwords-section` } : null),
  },
  webflow: {
    blurb: "Zippie needs a site API token with CMS access.",
    steps: [
      "Click Open Webflow and pick your site.",
      "Open Site settings, then Apps & integrations, then API access.",
      "Generate a token with CMS read and write, then paste it below.",
      "Open your blog collection's settings and copy its collection ID.",
    ],
    open: () => ({ label: "Open Webflow", href: "https://webflow.com/dashboard" }),
  },
  shopify: {
    blurb: "Zippie needs an Admin API token from a custom app with write_content access.",
    steps: [
      "Type your store address below, then click Open Shopify.",
      "Click Create an app, name it Arrowsterr, and give it the write_content scope.",
      "Install the app and copy the Admin API access token. Paste it below.",
      "Open your blog in the Shopify admin. The number at the end of its address is the blog ID.",
    ],
    open: (f) => {
      const shop = (f.shop ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      return shop ? { label: "Open Shopify", href: `https://${shop}/admin/settings/apps/development` } : null;
    },
  },
  hubspot: {
    blurb: "Zippie needs a private app token with the content scope.",
    steps: [
      "Click Open HubSpot and sign in.",
      "Open Settings, then Integrations, then Private apps, and click Create a private app.",
      "Name it Arrowsterr, tick the content scope, create it and copy the token. Paste it below.",
      "Open your blog's settings. The number in its address is the blog ID.",
    ],
    open: () => ({ label: "Open HubSpot", href: "https://app.hubspot.com" }),
  },
  ghost: {
    blurb: "Zippie needs the Admin API key from a custom integration.",
    steps: [
      "Type your Ghost address below, then click Open Ghost.",
      "Click Add custom integration and name it Arrowsterr.",
      "Copy the Admin API key and the API URL, and paste them below.",
    ],
    open: (f) => (site(f.siteUrl) ? { label: "Open Ghost", href: `${site(f.siteUrl)}/ghost/#/settings/integrations` } : null),
  },
};
