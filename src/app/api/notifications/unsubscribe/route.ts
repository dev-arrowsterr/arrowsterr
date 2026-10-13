import { esc } from "@/lib/email";
import { KINDS, signedOk, type Kind } from "@/lib/notify";
import { adminClient } from "@/lib/serverAuth";

// The unsubscribe link in notification emails. Opening it shows a button, so a mail scanner that follows links
// can't turn emails off. Email apps that support one-click unsubscribe POST here directly.

const app = () => process.env.APP_URL?.trim().replace(/\/+$/, "") || "https://app.arrowsterr.com";

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;background:#f6f7f9;font-family:Inter,Arial,sans-serif;color:#1b2230"><div style="max-width:480px;margin:64px auto;background:#fff;border-radius:16px;padding:32px">
<div style="font-size:15px;font-weight:600;color:#0943B0;padding-bottom:20px">Arrowsterr</div><h1 style="font-size:22px;margin:0 0 12px">${esc(title)}</h1>${body}</div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

const link = `<p style="font-size:14px"><a href="${app()}/settings/notifications" style="color:#0943B0">Change your emails in Arrowsterr</a></p>`;

function read(url: URL) {
  const u = url.searchParams.get("u") ?? "";
  const w = url.searchParams.get("w") ?? "";
  const k = url.searchParams.get("k") ?? "";
  const s = url.searchParams.get("s") ?? "";
  return signedOk(u, w, k, s) ? { u, w, k: k as Kind } : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const p = read(url);
  if (!p) return page("This link doesn't work", `<p style="font-size:15px;line-height:1.6">It may be cut short. You can turn emails off in Arrowsterr instead.</p>${link}`, 400);
  return page(
    `Stop ${KINDS[p.k]}?`,
    `<p style="font-size:15px;line-height:1.6">You won't get ${esc(KINDS[p.k])} for this workspace anymore. Other emails stay on.</p>
<form method="post" action="${esc(url.pathname + url.search)}"><button type="submit" style="background:#0943B0;color:#fff;border:0;border-radius:10px;padding:12px 20px;font-size:15px;cursor:pointer">Unsubscribe</button></form>${link}`,
  );
}

export async function POST(request: Request) {
  const p = read(new URL(request.url));
  if (!p) return page("This link doesn't work", link, 400);
  const db = adminClient();
  if (!db) return page("Something went wrong", `<p>Try again in a moment.</p>${link}`, 500);
  const { error } = await db.from("notification_prefs").upsert({ workspace_id: p.w, user_id: p.u, [p.k]: false, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,user_id" });
  if (error) return page("Something went wrong", `<p style="font-size:15px">${esc(error.message)}</p>${link}`, 500);
  return page("You're unsubscribed", `<p style="font-size:15px;line-height:1.6">You won't get ${esc(KINDS[p.k])} for this workspace anymore.</p>${link}`);
}
