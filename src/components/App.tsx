"use client";

import { useState } from "react";
import { BrandLogo } from "./BrandLogo";
import { Logo } from "./Logo";
import { PromptsPage } from "./PromptsPage";

export type Brand = {
  id: string;
  url: string;
  domain: string;
  name: string;
  logo: string;
  category: string;
  prompts: string[];
};

type Suggestion = Omit<Brand, "id">;
type Page = "dashboard" | "prompts" | "sources" | "competitors";

// Brands live in this browser for now. Step 5 moves them to the database.
const STORE = "arrowsterr.brands";

function load(): Brand[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "[]");
  } catch {
    return [];
  }
}

function save(brands: Brand[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(brands));
  } catch {
    // Storage blocked. The app still works until the page reloads.
  }
}

export function App() {
  // This component only renders in the browser (see ClientApp), so it can read storage right away.
  const [brands, setBrands] = useState<Brand[]>(load);
  const [activeId, setActiveId] = useState<string | null>(() => brands[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState<Page>("prompts");

  function addBrand(brand: Brand) {
    const next = [...brands, brand];
    setBrands(next);
    save(next);
    setActiveId(brand.id);
    setPage("prompts");
    setAdding(false);
  }

  function updateBrand(brand: Brand) {
    const next = brands.map((b) => (b.id === brand.id ? brand : b));
    setBrands(next);
    save(next);
  }

  function removeBrand(id: string) {
    const next = brands.filter((b) => b.id !== id);
    setBrands(next);
    save(next);
    setActiveId(next[0]?.id ?? null);
  }

  const active = brands.find((b) => b.id === activeId);
  if (adding || !active) {
    return <Onboarding onDone={addBrand} onCancel={brands.length ? () => setAdding(false) : undefined} />;
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar
        brands={brands}
        active={active}
        page={page}
        onPage={setPage}
        onSwitch={setActiveId}
        onAdd={() => setAdding(true)}
      />
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8">
        {page === "prompts" ? (
          <PromptsPage key={active.id} brand={active} onChange={updateBrand} onRemove={() => removeBrand(active.id)} />
        ) : (
          <ComingSoon page={page} />
        )}
      </main>
    </div>
  );
}

// ─────────────────────────────── sidebar ───────────────────────────────

const NAV: { group: string; items: { id: Page; label: string }[] }[] = [
  { group: "General", items: [{ id: "dashboard", label: "Dashboard" }, { id: "prompts", label: "Prompts" }, { id: "sources", label: "Sources" }] },
  { group: "Preferences", items: [{ id: "competitors", label: "Competitors" }] },
];

function Sidebar({
  brands,
  active,
  page,
  onPage,
  onSwitch,
  onAdd,
}: {
  brands: Brand[];
  active: Brand;
  page: Page;
  onPage: (p: Page) => void;
  onSwitch: (id: string) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <aside className="flex shrink-0 flex-col gap-6 border-b-2 border-line bg-white px-4 py-5 md:min-h-screen md:w-64 md:border-r-2 md:border-b-0">
      <Logo size="md" />
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-3 rounded-aw border-2 border-line bg-white px-3 py-2 text-left"
        >
          <BrandLogo src={active.logo} name={active.name} />
          <span className="min-w-0 flex-1 truncate font-medium text-ink">{active.name}</span>
          <span aria-hidden="true">▾</span>
        </button>
        {open ? (
          <div className="absolute z-10 mt-2 w-full rounded-aw border-2 border-line bg-white shadow-aw-sm">
            {brands.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  onSwitch(b.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-brand-pale"
              >
                <BrandLogo src={b.logo} name={b.name} size={22} />
                <span className="truncate text-[15px]">{b.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onAdd();
              }}
              className="w-full border-t border-border px-3 py-2 text-left text-[15px] font-medium text-brand hover:bg-brand-pale"
            >
              + Add a brand
            </button>
          </div>
        ) : null}
      </div>
      <nav className="flex flex-row flex-wrap gap-x-6 gap-y-4 md:flex-col">
        {NAV.map((g) => (
          <div key={g.group} className="flex flex-col gap-1">
            <span className="text-[12px] text-g500">{g.group}</span>
            {g.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPage(item.id)}
                className={`rounded-aw px-3 py-2 text-left text-[15px] font-medium ${
                  page === item.id ? "bg-brand text-white" : "text-ink-2 hover:bg-brand-pale"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

function ComingSoon({ page }: { page: Page }) {
  const step = page === "dashboard" || page === "sources" || page === "competitors" ? 6 : 4;
  return (
    <div className="aw-callout max-w-xl text-[16px]!">
      The {page} page arrives in Step {step}. For now, set up your prompts on the Prompts page.
    </div>
  );
}

// ─────────────────────────────── onboarding ───────────────────────────────

function Onboarding({ onDone, onCancel }: { onDone: (b: Brand) => void; onCancel?: () => void }) {
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<Suggestion | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [custom, setCustom] = useState("");

  async function lookUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website }),
      });
      const data = await res.json().catch(() => ({ error: `The server returned ${res.status}.` }));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      setFound(data);
      setPicked(new Set(data.prompts));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function toggle(p: string) {
    const next = new Set(picked);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setPicked(next);
  }

  function addCustom() {
    const p = custom.trim();
    if (!p || !found) return;
    if (!found.prompts.includes(p)) setFound({ ...found, prompts: [...found.prompts, p] });
    setPicked(new Set([...picked, p]));
    setCustom("");
  }

  return (
    <main className="aw-dotgrid flex min-h-screen justify-center px-4 py-10">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <Logo size="md" />
          {onCancel ? (
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </div>

        {!found ? (
          <form onSubmit={lookUp} className="aw-frame aw-frame--shadow">
            <div className="aw-frame__body flex flex-col gap-6">
              <h1 className="aw-h2 mb-0!">Track your brand in AI search</h1>
              <div>
                <label className="aw-label" htmlFor="website">
                  Your website
                </label>
                <input
                  id="website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="acme.com"
                  required
                  autoFocus
                  className="aw-input aw-input--hero"
                />
              </div>
              {error ? <p className="aw-error">{error}</p> : null}
              <div>
                <button type="submit" className="aw-btn aw-btn--primary aw-btn--lg" disabled={busy}>
                  {busy ? "Reading your site (about 30 seconds)..." : "Continue"}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div className="aw-frame aw-frame--shadow">
            <div className="aw-frame__head">
              <BrandLogo src={found.logo} name={found.name} size={36} />
              <div className="min-w-0">
                <div className="aw-h4">{found.name}</div>
                <div className="aw-small">{found.domain}</div>
              </div>
            </div>
            <div className="aw-frame__body flex flex-col gap-6">
              <h1 className="aw-h3">Suggested prompts</h1>
              {found.category ? <p className="aw-small">{found.category}</p> : null}
              <ul className="flex flex-col divide-y divide-border rounded-aw border border-border">
                {found.prompts.map((p) => (
                  <li key={p}>
                    <label className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-brand-pale">
                      <input
                        type="checkbox"
                        checked={picked.has(p)}
                        onChange={() => toggle(p)}
                        className="mt-1 h-4 w-4 accent-[#1E7A4D]"
                      />
                      <span className="text-[15px] text-ink-2">{p}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex gap-3">
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustom();
                    }
                  }}
                  placeholder="Add your own prompt"
                  className="aw-input"
                />
                <button type="button" className="aw-btn aw-btn--secondary" onClick={addCustom}>
                  Add
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  className="aw-btn aw-btn--primary aw-btn--lg"
                  disabled={!picked.size}
                  onClick={() =>
                    onDone({
                      ...found,
                      id: crypto.randomUUID(),
                      prompts: found.prompts.filter((p) => picked.has(p)),
                    })
                  }
                >
                  Start tracking {picked.size} prompts
                </button>
                <button type="button" className="aw-text-link" onClick={() => setFound(null)}>
                  Use a different website
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
