import "server-only";

// Sends email through Resend. Needs RESEND_API_KEY and EMAIL_FROM (like "Arrowsterr <hello@arrowsterr.com>") on Render.

export const emailReady = () => Boolean(process.env.RESEND_API_KEY?.trim());

export async function sendEmail(to: string[], subject: string, html: string) {
  if (!emailReady() || !to.length) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM?.trim() || "Arrowsterr <hello@arrowsterr.com>", to, subject, html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A plain, on-brand email: a heading, a few lines and one button. */
export function emailHtml(title: string, lines: string[], button: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Inter,Arial,sans-serif;color:#1b2230">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;padding:32px">
<tr><td style="font-size:15px;font-weight:600;color:#0943B0;padding-bottom:20px">Arrowsterr</td></tr>
<tr><td style="font-size:22px;font-weight:600;line-height:1.3;padding-bottom:16px">${esc(title)}</td></tr>
${lines.map((l) => `<tr><td style="font-size:15px;line-height:1.6;color:#3d4657;padding-bottom:12px">${esc(l)}</td></tr>`).join("")}
<tr><td style="padding-top:12px"><a href="${esc(button.url)}" style="display:inline-block;background:#0943B0;color:#fff;text-decoration:none;font-size:15px;font-weight:500;padding:12px 20px;border-radius:10px">${esc(button.label)}</a></td></tr>
</table></td></tr></table></body></html>`;
}
