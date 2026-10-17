"use client";
/* eslint-disable @next/next/no-img-element -- logos come from any site, like BrandLogo */

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { cleanKit, type BrandKit } from "@/lib/brandKit";
import type { PdfDesign } from "@/lib/pdf/design";
import type { PdfPage } from "@/lib/pdf/pages";
import { PDF_PAGES } from "@/lib/pdf/pages";
import type { RunAuth } from "@/lib/runner";
import { Modal } from "../reports/Dialog";
import { errText, post } from "../reports/reportApi";

// Download PDF on every page (docs/reports.md, section 32.2): pick a design, the server makes the file,
// it downloads and is kept in Reports.

type State = { at: "pick" } | { at: "making" } | { at: "stalled" } | { at: "failed"; error: string };

export function DownloadPdf({
  sb,
  auth,
  page,
  brand,
  params,
  whiteLabel,
  onBrandKit,
}: {
  sb: SupabaseClient;
  auth: RunAuth;
  page: PdfPage;
  brand: { id: string; name: string };
  params: { days: number; topic: string; model: string };
  whiteLabel: boolean;
  onBrandKit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kit, setKit] = useState<BrandKit | null | undefined>(undefined);
  const [design, setDesign] = useState<PdfDesign>("arrowsterr");
  const [state, setState] = useState<State>({ at: "pick" });

  useEffect(() => {
    if (!open || kit !== undefined) return;
    sb.from("brand_kits")
      .select("kit")
      .eq("workspace_id", auth.workspaceId)
      .eq("key", "workspace")
      .maybeSingle()
      .then(({ data }) => {
        setKit(data ? cleanKit((data as { kit: unknown }).kit) : null);
        // White label teams with a kit mostly send their own look, so it starts picked.
        if (data && whiteLabel) setDesign("brand");
      });
  }, [open, kit, sb, auth.workspaceId, whiteLabel]);

  const close = () => {
    setOpen(false);
    setState({ at: "pick" });
  };

  async function download() {
    setState({ at: "making" });
    try {
      const { fileId } = await post<{ fileId: string }>(auth, "/api/files", { page, brandId: brand.id, design, params });
      const until = Date.now() + 4 * 60_000;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await post<{ status: string; url?: string; error?: string }>(auth, "/api/files", { action: "status", fileId });
        if (s.status === "ready" && s.url) {
          window.location.assign(s.url);
          close();
          return;
        }
        if (s.status === "failed") return setState({ at: "failed", error: s.error ?? "The PDF failed." });
        if (s.status === "stalled") return setState({ at: "stalled" });
      }
      setState({ at: "stalled" });
    } catch (e) {
      setState({ at: "failed", error: errText(e) });
    }
  }

  const title = PDF_PAGES.find((p) => p.id === page)!.title;
  const filters = [`Last ${params.days} days`, params.topic !== "All" ? params.topic : "", params.model !== "All" ? params.model : ""].filter(Boolean).join(" · ");
  const brandReady = whiteLabel && Boolean(kit);

  return (
    <>
      <button type="button" className="aw-ctl" onClick={() => setOpen(true)}>
        Download PDF
      </button>
      {open ? (
        <Modal title="Download PDF" onClose={close} width="max-w-xl">
          <div className="flex flex-col gap-1">
            <h2 className="aw-h3 mb-0!">{title}</h2>
            <p className="text-[13px] text-muted">
              {brand.name} · {filters}
            </p>
          </div>
          <div className="aw-design" role="radiogroup" aria-label="Design">
            <button type="button" role="radio" aria-checked={design === "arrowsterr"} className={`aw-design__card ${design === "arrowsterr" ? "is-on" : ""}`} onClick={() => setDesign("arrowsterr")}>
              <span className="aw-design__cover" style={{ background: "#0B1B3F" }}>
                <img src="/brand/arrowsterr-logo-white.svg" alt="" />
                <i style={{ background: "#0943B0" }} />
              </span>
              <b>Arrowsterr</b>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={design === "brand"}
              disabled={!brandReady}
              className={`aw-design__card ${design === "brand" ? "is-on" : ""}`}
              onClick={() => setDesign("brand")}
            >
              {kit ? (
                <span className="aw-design__cover" style={{ background: kit.logoOnDark ? kit.colors.ink : kit.colors.surface, boxShadow: "inset 0 0 0 1px var(--aw-rule)" }}>
                  {kit.logo ? <img src={kit.logo} alt="" /> : <b style={{ color: kit.colors.ink }}>{kit.name}</b>}
                  <i style={{ background: kit.colors.primary }} />
                </span>
              ) : (
                <span className="aw-design__cover aw-design__cover--empty">Brand Kit</span>
              )}
              <b>{kit?.name ? `${kit.name} style` : "Your brand's style"}</b>
              {!whiteLabel ? <span className="aw-status aw-status--pending">Agency</span> : null}
            </button>
          </div>
          {whiteLabel && kit === null ? (
            <button type="button" className="aw-text-link self-start" onClick={onBrandKit}>
              Set up your Brand Kit
            </button>
          ) : null}
          {state.at === "failed" ? <p className="aw-error">{state.error}</p> : null}
          {state.at === "stalled" ? (
            <p className="aw-callout flex flex-wrap items-center gap-3 text-[13px]">
              The PDF is taking longer than usual.
              <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={() => window.print()}>
                Print this page instead
              </button>
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="aw-btn aw-btn--secondary aw-btn--sm" onClick={close}>
              Cancel
            </button>
            <button type="button" className="aw-btn aw-btn--primary aw-btn--sm" onClick={download} disabled={state.at === "making" || (design === "brand" && !brandReady)}>
              {state.at === "making" ? "Making your PDF…" : "Download"}
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
