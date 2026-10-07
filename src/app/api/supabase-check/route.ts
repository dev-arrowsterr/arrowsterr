// Open /api/supabase-check to test the Supabase settings on the server.
// The publishable key is public, but only its start and end are shown.
export async function GET() {
  const url = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  const report: Record<string, unknown> = {
    url,
    urlLooksRight: /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url),
    keyStart: key.slice(0, 18),
    keyEnd: key.slice(-4),
    keyLength: key.length,
    keyType: key.startsWith("sb_publishable_") ? "publishable" : key.startsWith("sb_secret_") ? "SECRET (wrong one)" : key.startsWith("eyJ") ? "legacy JWT" : "unknown",
  };
  if (key.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
      report.legacyKeyProject = payload.ref;
      report.legacyKeyRole = payload.role;
    } catch {
      report.legacyKeyProject = "could not read";
    }
  }
  if (url && key) {
    try {
      const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, signal: AbortSignal.timeout(10_000) });
      report.supabaseStatus = res.status;
      report.supabaseSays = res.ok ? "OK, the URL and key work together" : (await res.text()).slice(0, 300);
    } catch (e) {
      report.supabaseSays = `Could not reach the URL: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return Response.json(report);
}
