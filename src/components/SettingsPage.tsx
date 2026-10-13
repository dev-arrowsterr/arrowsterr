import type { ReactNode } from "react";

export type SettingsTab = "profile" | "security" | "settings" | "members" | "access" | "ai" | "retention" | "integrations" | "publishing" | "billing" | "exports" | "jobs";

/** Settings pages, grouped the way the sidebar shows them. */
export const SETTINGS_GROUPS: {
  label: string;
  tabs: { id: SettingsTab; label: string }[];
}[] = [
  {
    label: "Account",
    tabs: [
      { id: "profile", label: "Profile" },
      { id: "security", label: "Password and security" },
    ],
  },
  {
    label: "Workspace",
    tabs: [
      { id: "settings", label: "General" },
      { id: "members", label: "Members" },
      { id: "access", label: "Identity and access" },
      { id: "ai", label: "AI" },
      { id: "retention", label: "Data retention" },
    ],
  },
  {
    label: "Connections",
    tabs: [
      { id: "integrations", label: "Integrations" },
      { id: "publishing", label: "Publishing" },
    ],
  },
  { label: "Billing", tabs: [{ id: "billing", label: "Plans & billing" }] },
  {
    label: "Jobs",
    tabs: [
      { id: "exports", label: "Imports and exports" },
      { id: "jobs", label: "Background actions" },
    ],
  },
];

export const SETTINGS_TABS = SETTINGS_GROUPS.flatMap((g) => g.tabs);

/** Settings: a sidebar of areas on the left and the chosen page on the right. */
export function SettingsPage({ tab, onTab, children }: { tab: SettingsTab; onTab: (t: SettingsTab) => void; children: ReactNode }) {
  const title = SETTINGS_TABS.find((t) => t.id === tab)?.label ?? "Settings";
  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-10">
      <nav className="flex shrink-0 flex-col gap-4 md:sticky md:top-6 md:w-52 md:self-start" aria-label="Settings">
        <h1 className="aw-h2 mb-0!">Settings</h1>
        {SETTINGS_GROUPS.map((g) => (
          <div key={g.label} className="flex flex-col gap-0.5">
            <span className="px-2 pb-1 text-[12px] font-semibold text-muted">{g.label}</span>
            {g.tabs.map((t) => (
              <button key={t.id} type="button" aria-current={tab === t.id ? "page" : undefined} onClick={() => onTab(t.id)} className={`aw-mod__item ${tab === t.id ? "is-on" : ""}`}>
                {t.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <h2 className="aw-h3 mb-0!">{title}</h2>
        {children}
      </div>
    </div>
  );
}
