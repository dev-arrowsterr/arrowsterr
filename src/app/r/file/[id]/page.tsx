import type { Metadata } from "next";
import { connection } from "next/server";
import { PdfDoc } from "@/components/pdf/PdfDoc";
import type { PdfSnapshot } from "@/lib/pdf/pages";
import { checkFile } from "@/lib/reportLinks";
import { adminClient } from "@/lib/serverAuth";

export const metadata: Metadata = { title: "Report", robots: { index: false, follow: false } };

// The page the PDF worker prints for a saved file (docs/reports.md, section 32). It opens only with a signed link
// from /api/pdf/next, good for 15 minutes, and draws the snapshot stored when the file was made.
// [data-ready] tells the worker the file is on the page.
export default async function PrintFile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await connection();
  const { id } = await params;
  const q = await searchParams;
  let ok = false;
  try {
    ok = checkFile(id, q.exp ?? "", q.sig ?? "");
  } catch {
    ok = false;
  }
  const db = adminClient();
  const row = ok && db ? ((await db.from("report_files").select("snapshot").eq("id", id).maybeSingle()).data as { snapshot: PdfSnapshot } | null) : null;
  if (!row) return <main data-failed="This print link is not valid.">This print link is not valid.</main>;
  return (
    <main style={{ background: row.snapshot.tokens.paper }} data-ready="1">
      <PdfDoc s={row.snapshot} />
    </main>
  );
}
