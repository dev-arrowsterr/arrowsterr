"use client";

import { Dropdown } from "./Pickers";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { listWorkspaces, type Workspace } from "@/lib/db";
import { getSupabase, type SupaConfig } from "@/lib/supa";
import { AuthScreen } from "./AuthScreen";
import { Logo } from "./Logo";

const KEY = "aw.oauth.request";
type Ask = { client_id: string; redirect_uri: string; state: string; code_challenge: string; code_challenge_method: string };

/** The app's request, from the address bar. Kept in this tab so it survives a sign-in round trip. */
function readAsk(): Ask | null {
  const q = new URLSearchParams(window.location.search);
  if (q.get("client_id")) {
    const ask = Object.fromEntries(["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method"].map((k) => [k, q.get(k) ?? ""])) as Ask;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(ask));
    } catch {
      // Storage blocked. Email and password sign-in still works on this page.
    }
    return ask;
  }
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Ask | null;
  } catch {
    return null;
  }
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="aw-dotgrid flex min-h-screen justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <Logo size="md" />
        <div className="aw-frame">
          <div className="aw-frame__body flex flex-col gap-5">{children}</div>
        </div>
      </div>
    </main>
  );
}

/** Approve an AI app for one workspace. The app then reads results and plans through the MCP server. */
export function Authorize({ config }: { config: SupaConfig }) {
  const sb = useMemo(() => getSupabase(config), [config]);
  const [ask] = useState(readAsk);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [app, setApp] = useState<{ name: string; host: string } | null>(null);
  const [spaces, setSpaces] = useState<Workspace[] | null>(null);
  const [ws, setWs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [sb]);

  useEffect(() => {
    if (!ask) return;
    fetch(`/api/oauth/client?${new URLSearchParams({ client_id: ask.client_id, redirect_uri: ask.redirect_uri })}`)
      .then(async (r) => {
        const out = await r.json();
        if (!r.ok) throw new Error(out.error);
        setApp(out);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ask]);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    listWorkspaces(sb, userId)
      .then((all) => {
        const mine = all.filter((w) => w.role === "owner" || w.role === "admin");
        setSpaces(mine);
        setWs((w) => w || mine[0]?.id || "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sb, userId]);

  async function answer(deny: boolean) {
    if (!ask || !session) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/oauth/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ ...ask, workspaceId: ws || spaces?.[0]?.id, deny }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        // Nothing to clear.
      }
      window.location.href = out.redirect;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!ask)
    return (
      <Frame>
        <h1 className="aw-h3 mb-0!">Nothing to approve</h1>
        <p className="text-[15px] text-body">Start the connection from your AI app, like Claude or Cursor. It sends you back here to approve it.</p>
      </Frame>
    );
  if (session === undefined) return <Frame>{null}</Frame>;
  if (!session) return <AuthScreen sb={sb} invited={false} />;

  return (
    <Frame>
      <div className="flex flex-col gap-1.5">
        <h1 className="aw-h3 mb-0!">Connect {app?.name ?? "this app"} to Arrowsterr</h1>
        {app ? <p className="aw-small">It will send you back to {app.host}.</p> : null}
      </div>
      {error ? <p className="aw-error">{error}</p> : null}
      <div className="flex flex-col gap-2 text-[14px] text-body">
        <span className="font-medium text-ink">It will be able to:</span>
        <ul className="aw-list aw-list--tight aw-list--dots">
          <li>Read your AI visibility, competitors, prompts and cited sources</li>
          <li>Read your Content Plan and Topic Bank, and run keyword research with your plan&apos;s tasks</li>
          <li>Add prompts and Content Plan pieces when you ask it to</li>
        </ul>
      </div>
      {spaces === null ? (
        <p className="aw-small">Loading your workspaces...</p>
      ) : spaces.length === 0 ? (
        <p className="aw-callout text-[14px]">You need to be an admin of a workspace to connect apps. Ask a workspace admin to connect it, or to make you an admin.</p>
      ) : (
        <label className="flex flex-col gap-1 text-[13px] text-body">
          Workspace
          <Dropdown label="Workspace" value={ws} onChange={setWs} className="aw-dropdown--field w-full" disabled={spaces.length === 1} options={spaces.map((w) => ({ id: w.id, label: w.name }))} />
        </label>
      )}
      <div className="flex gap-2">
        <button type="button" className="aw-btn aw-btn--primary flex-1" onClick={() => answer(false)} disabled={busy || !app || !spaces?.length}>
          {busy ? "Connecting..." : "Allow"}
        </button>
        <button type="button" className="aw-btn aw-btn--secondary" onClick={() => answer(true)} disabled={busy || !app}>
          Cancel
        </button>
      </div>
      <p className="aw-small">
        Signed in as {session.user.email}. You can disconnect it any time in Settings → Integrations.{" "}
        <button type="button" className="underline" onClick={() => sb.auth.signOut()}>
          Use another account
        </button>
      </p>
    </Frame>
  );
}
