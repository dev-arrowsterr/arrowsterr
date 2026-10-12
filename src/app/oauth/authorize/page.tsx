import type { Metadata } from "next";
import { connection } from "next/server";
import { ClientAuthorize } from "@/components/ClientAuthorize";

export const metadata: Metadata = { title: "Connect an app · Arrowsterr", robots: { index: false, follow: false } };

// Where AI apps (Claude, ChatGPT, Cursor) send people to approve access to a workspace.
export default async function AuthorizePage() {
  await connection();
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  return <ClientAuthorize config={{ url, key }} />;
}
