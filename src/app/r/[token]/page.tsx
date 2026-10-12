import type { Metadata } from "next";
import { connection } from "next/server";
import { PrintButton } from "@/components/reports/PrintButton";
import { CompetitorsDoc } from "@/components/reports/CompetitorsDoc";
import { IntelDoc } from "@/components/reports/IntelDoc";
import { PromptsDoc } from "@/components/reports/PromptsDoc";
import { ReportDoc } from "@/components/reports/ReportDoc";
import type { CompetitorsSnapshot, IntelSnapshot, PromptsSnapshot, ReportSnapshot } from "@/lib/reportTypes";
import { themeOf } from "@/lib/reportTheme";
import { adminClient } from "@/lib/serverAuth";

export const metadata: Metadata = { title: "Shared report", robots: { index: false, follow: false } };

// A shared client report. Anyone with the link can read it; nothing else in the workspace is exposed.
export default async function SharedReport({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const db = adminClient();
  const row = /^[a-f0-9]{48,64}$/.test(token) && db ? (await db.from("shared_reports").select("data").eq("token", token).maybeSingle()).data : null;
  if (!row) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="aw-callout max-w-md">This report link is not valid or was removed.</p>
      </main>
    );
  }
  const kind = (row.data as { kind?: string }).kind;
  const isPrompts = kind === "prompts" || kind === "competitors" || kind === "intel";
  const paper = isPrompts ? undefined : themeOf((row.data as ReportSnapshot).style ?? { color: "" }).paper;
  return (
    <main className="aw-read min-h-screen bg-surface-2 py-8 print:bg-white print:py-0" style={paper ? { background: paper } : undefined}>
      <div className="mx-auto mb-4 flex max-w-6xl justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      {kind === "competitors" ? <CompetitorsDoc r={row.data as CompetitorsSnapshot} /> : kind === "prompts" ? <PromptsDoc r={row.data as PromptsSnapshot} /> : kind === "intel" ? <IntelDoc r={row.data as IntelSnapshot} /> : <ReportDoc r={row.data as ReportSnapshot} />}
    </main>
  );
}
