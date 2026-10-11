import type { ReactNode } from "react";

export type SettingsTab = "settings" | "members" | "integrations" | "billing";

export const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "settings", label: "Workspace" },
  { id: "members", label: "Members" },
  { id: "integrations", label: "Integrations" },
  { id: "billing", label: "Plans & billing" },
];

/** Settings: one heading, a tab per area, and the chosen tab below. */
export function SettingsPage({ tab, onTab, children }: { tab: SettingsTab; onTab: (t: SettingsTab) => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="aw-h2 mb-0!">Settings</h1>
      <nav className="-mt-2 flex flex-wrap border-b border-rule" aria-label="Settings">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => onTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[14px] ${tab === t.id ? "border-brand font-semibold text-ink" : "border-transparent text-body hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {children}
    </div>
  );
}
