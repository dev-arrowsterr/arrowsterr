import type { Metadata } from "next";
import { connection } from "next/server";
import { PrintButton } from "@/components/reports/PrintButton";
import { PromptsDoc } from "@/components/reports/PromptsDoc";
import { ReportDoc } from "@/components/reports/ReportDoc";
import type { PromptsSnapshot, ReportSnapshot } from "@/lib/reportTypes";
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
  return (
    <main className="min-h-screen bg-surface-2 py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-6xl justify-end px-4 print:hidden">
        <PrintButton />
      </div>
      {(row.data as { kind?: string }).kind === "prompts" ? <PromptsDoc r={row.data as PromptsSnapshot} /> : <ReportDoc r={row.data as ReportSnapshot} />}
    </main>
  );
}
