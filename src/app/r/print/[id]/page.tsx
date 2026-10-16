import type { Metadata } from "next";
import { connection } from "next/server";
import { ReportDoc } from "@/components/reports/ReportDoc";
import { parseRange } from "@/lib/reportRange";
import { buildSaved, checkPrint, REPORT_COLS, type ReportRow } from "@/lib/reportServer";
import { themeOf } from "@/lib/reportTheme";
import { adminClient } from "@/lib/serverAuth";

export const metadata: Metadata = { title: "Report", robots: { index: false, follow: false } };
export const maxDuration = 120;

// The page the PDF worker prints. It opens only with a signed link from /api/pdf/next, good for 15 minutes.
// [data-ready] tells the worker the report is on the page.
export default async function PrintReport({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await connection();
  const { id } = await params;
  const q = await searchParams;
  const rangeJson = q.range ?? "";
  let ok = false;
  try {
    ok = checkPrint(id, rangeJson, q.exp ?? "", q.sig ?? "");
  } catch {
    ok = false;
  }
  const db = adminClient();
  const row = ok && db ? ((await db.from("reports").select(REPORT_COLS).eq("id", id).maybeSingle()).data as ReportRow | null) : null;
  if (!row || !db) return <main data-failed="This print link is not valid.">This print link is not valid.</main>;
  let range;
  try {
    range = parseRange(JSON.parse(rangeJson));
  } catch {
    range = parseRange(row.range);
  }
  const { snapshot } = await buildSaved(db, row, { range });
  return (
    <main className="aw-read" style={{ background: themeOf(snapshot.style).paper }} data-ready="1">
      <ReportDoc r={snapshot} />
    </main>
  );
}
