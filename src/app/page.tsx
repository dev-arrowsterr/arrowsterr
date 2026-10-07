import { connection } from "next/server";
import { ClientApp } from "@/components/ClientApp";
import { Logo } from "@/components/Logo";

export default async function Home() {
  // Read settings when the page is requested, so changes on Render apply without a rebuild.
  await connection();
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  const missing = [!url && "SUPABASE_URL", !key && "SUPABASE_PUBLISHABLE_KEY"].filter(Boolean) as string[];
  const wrongKey = key && !key.startsWith("sb_publishable_") && !key.startsWith("eyJ");

  if (missing.length || wrongKey) {
    return (
      <main className="aw-dotgrid flex min-h-screen justify-center px-4 py-10">
        <div className="flex w-full max-w-xl flex-col gap-6">
          <Logo size="md" />
          <div className="aw-frame aw-frame--shadow">
            <div className="aw-frame__body flex flex-col gap-4">
              <h1 className="aw-h3 mb-0!">Connect Supabase</h1>
              {missing.length ? (
                <>
                  <p className="text-[16px]">Add these in Render under Environment, then redeploy:</p>
                  <ul className="aw-list aw-list--tight aw-list--dots">
                    {missing.map((m) => (
                      <li key={m}>
                        <code>{m}</code>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {wrongKey ? (
                <p className="aw-error">
                  SUPABASE_PUBLISHABLE_KEY should start with sb_publishable_. Copy it from Supabase, Project Settings, API Keys.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    );
  }
  return <ClientApp config={{ url, key }} />;
}
