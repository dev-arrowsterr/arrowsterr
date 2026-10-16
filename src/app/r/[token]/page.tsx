import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { PrintButton } from "@/components/reports/PrintButton";
import { CompetitorsDoc } from "@/components/reports/CompetitorsDoc";
import { IntelDoc } from "@/components/reports/IntelDoc";
import { LinkViews } from "@/components/reports/LinkViews";
import { PromptsDoc } from "@/components/reports/PromptsDoc";
import { ReportDoc } from "@/components/reports/ReportDoc";
import { UnlockForm } from "@/components/reports/UnlockForm";
import { liveSnapshot } from "@/lib/reportLive";
import { checkSig, unlockCookie } from "@/lib/reportServer";
import type { CompetitorsSnapshot, IntelSnapshot, PromptsSnapshot, ReportSnapshot } from "@/lib/reportTypes";
import { themeOf } from "@/lib/reportTheme";
import { adminClient } from "@/lib/serverAuth";

export const metadata: Metadata = { title: "Shared report", robots: { index: false, follow: false } };
export const maxDuration = 120;

type Link = { token: string; report_id: string | null; mode: "live" | "frozen"; snapshot: unknown; password_hash: string | null; expires_at: string | null; revoked_at: string | null };

const past = (iso: string) => Date.parse(iso) < Date.now();

const Note = ({ text }: { text: string }) => (
  <main className="flex min-h-screen items-center justify-center p-6">
    <p className="aw-callout max-w-md">{text}</p>
  </main>
);

// A shared report (docs/reports.md, section 13). Anyone with the link can read it; nothing else in the workspace is exposed.
//   live: the saved report with fresh numbers, cached for an hour.
//   frozen: the numbers from when the link was made.
// Links made before supabase/043_reports.sql still open from shared_reports.
export default async function SharedReport({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const db = adminClient();
  if (!/^[a-f0-9]{48,64}$/.test(token) || !db) return <Note text="This report link is not valid or was removed." />;

  const { data: linkRow, error } = await db.from("report_links").select("token, report_id, mode, snapshot, password_hash, expires_at, revoked_at").eq("token", token).maybeSingle();
  const link = linkRow as Link | null;
  let data: unknown = null;
  let count = false;
  if (link) {
    if (link.revoked_at) return <Note text="This report is no longer shared." />;
    if (link.expires_at && past(link.expires_at)) return <Note text="This report link has expired." />;
    if (link.password_hash) {
      const given = (await cookies()).get(unlockCookie(token))?.value ?? "";
      let open = false;
      try {
        open = checkSig(`unlock:${token}:${link.password_hash}`, given);
      } catch {
        open = false;
      }
      if (!open) {
        return (
          <main className="flex min-h-screen items-center justify-center bg-surface-2 p-6">
            <UnlockForm token={token} />
          </main>
        );
      }
    }
    if (link.mode === "live") {
      try {
        data = link.report_id ? await liveSnapshot(db, link.report_id) : null;
      } catch (e) {
        console.error("Live report failed:", e instanceof Error ? e.message : e);
        return <Note text="This report can't be loaded right now. Try again in a few minutes." />;
      }
      if (!data) return <Note text="This report is no longer shared." />;
    } else data = link.snapshot;
    count = true;
  } else {
    // Before the migration, or a token from the older table.
    if (error && !/report_links/.test(error.message)) console.error("Share link failed:", error.message);
    data = (await db.from("shared_reports").select("data").eq("token", token).maybeSingle()).data?.data ?? null;
  }
  if (!data || typeof data !== "object") return <Note text="This report link is not valid or was removed." />;

  const kind = (data as { kind?: string }).kind;
  const isPrompts = kind === "prompts" || kind === "competitors" || kind === "intel";
  const paper = isPrompts ? undefined : themeOf((data as ReportSnapshot).style ?? { color: "" }).paper;
  return (
    <main className="aw-read min-h-screen bg-surface-2 py-8 print:bg-white print:py-0" style={paper ? { background: paper } : undefined}>
      {count ? <LinkViews token={token} /> : null}
      <div className="mx-auto mb-4 flex max-w-6xl justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      {kind === "competitors" ? <CompetitorsDoc r={data as CompetitorsSnapshot} /> : kind === "prompts" ? <PromptsDoc r={data as PromptsSnapshot} /> : kind === "intel" ? <IntelDoc r={data as IntelSnapshot} /> : <ReportDoc r={data as ReportSnapshot} />}
    </main>
  );
}
