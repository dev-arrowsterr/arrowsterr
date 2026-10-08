"use client";

import { useState } from "react";

export const PLATFORMS: { id: string; label: string; steps: string[] }[] = [
  {
    id: "wordpress",
    label: "WordPress",
    steps: [
      "In WordPress, go to Plugins → Add New Plugin and search for WPCode. Click Install, then Activate.",
      "Go to Code Snippets → Header & Footer.",
      "Paste the code into the Header box and click Save Changes.",
    ],
  },
  {
    id: "shopify",
    label: "Shopify",
    steps: [
      "In Shopify, go to Online Store → Themes. Next to your live theme, click ⋯ → Edit code.",
      "Open layout → theme.liquid.",
      "Paste the code on the line just above </head>, then click Save.",
    ],
  },
  {
    id: "webflow",
    label: "Webflow",
    steps: ["Open Site settings → Custom code.", "Paste the code into Head code and click Save.", "Click Publish so the change goes live."],
  },
  {
    id: "wix",
    label: "Wix",
    steps: [
      "In Wix, go to Settings → Custom Code → + Add Custom Code. A paid Wix plan with a connected domain is needed.",
      "Paste the code. Choose All pages and Head.",
      "Click Apply.",
    ],
  },
  {
    id: "squarespace",
    label: "Squarespace",
    steps: ["Go to Website → Website Tools → Code Injection. On older sites it's Settings → Advanced → Code Injection.", "Paste the code into Header.", "Click Save."],
  },
  {
    id: "framer",
    label: "Framer",
    steps: ["Open Site Settings → General → Custom Code.", "Paste the code into End of <head> tag.", "Click Save, then Publish."],
  },
  {
    id: "gtm",
    label: "Google Tag Manager",
    steps: ["In Tag Manager, go to Tags → New → Custom HTML.", "Paste the code. Set the trigger to All Pages and save.", "Click Submit, then Publish."],
  },
  {
    id: "other",
    label: "Other or custom",
    steps: ["Paste the code into the <head> of every page, or into your site's shared header template.", "Deploy or publish the site."],
  },
];

export function snippetFor(origin: string, websiteId: string, domain: string) {
  return `<script defer src="${origin}/t/script.js" data-website-id="${websiteId}" data-host-url="${origin}/t" data-domains="${domain},www.${domain}"></script>`;
}

export function Copy({ text, label = "Copy code" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="aw-btn aw-btn--accent aw-btn--sm"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        })
      }
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** The code to paste, and short steps for the platform the site is built on. */
export function InstallGuide({ snippet, platform }: { snippet: string; platform: string }) {
  const [pick, setPick] = useState(PLATFORMS.some((p) => p.id === platform) ? platform : "other");
  const p = PLATFORMS.find((x) => x.id === pick)!;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="aw-label">Your site is built with</span>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setPick(x.id)}
              aria-pressed={pick === x.id}
              className={`border px-3 py-1.5 text-[13px] ${pick === x.id ? "border-ink bg-ink text-white" : "border-rule bg-white text-body hover:border-ink"}`}
            >
              {x.label}
              {x.id === platform && x.id !== "other" ? <span className="ml-1.5 font-mono text-[10px] opacity-70">DETECTED</span> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="aw-label">1 · Copy this code</span>
        <div className="flex flex-col gap-3 border border-rule bg-surface-2 p-4 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 break-all font-mono text-[12px] leading-relaxed text-ink">{snippet}</code>
          <Copy text={snippet} />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="aw-label">2 · Add it to {p.label}</span>
        <ol className="flex flex-col gap-2.5">
          {p.steps.map((s, i) => (
            <li key={s} className="flex gap-3 text-[14px] text-body">
              <span className="aw-num flex h-6 w-6 shrink-0 items-center justify-center border border-rule text-[12px] text-ink">{i + 1}</span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="aw-small">
        The code is about 2 KB, loads after your page, and uses no cookies. It only counts visits on your own domain.
      </p>
    </div>
  );
}
