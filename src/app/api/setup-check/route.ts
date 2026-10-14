import { availableEngines, ENGINES, viaDfs } from "@/lib/engines";
import { supabaseUrl } from "@/lib/serverAuth";

// Open /api/setup-check to test the server's settings. Secrets are never shown, only whether they work.
export async function GET() {
  const url = supabaseUrl();
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  const secret = (process.env.SUPABASE_SECRET_KEY ?? "").trim();
  const report: Record<string, unknown> = {};

  const ping = async (path: string, apikey: string) => {
    try {
      const res = await fetch(`${url}${path}`, { headers: { apikey }, signal: AbortSignal.timeout(10_000) });
      return res.ok ? "OK" : `Failed (${res.status}): ${(await res.text()).slice(0, 200)}`;
    } catch (e) {
      return `Could not reach Supabase: ${e instanceof Error ? e.message : String(e)}`;
    }
  };

  report.SUPABASE_URL = url || "MISSING";
  report.SUPABASE_PUBLISHABLE_KEY = !key ? "MISSING" : url ? await ping("/auth/v1/settings", key) : "Set SUPABASE_URL first";
  report.SUPABASE_SECRET_KEY = !secret
    ? "MISSING (needed for daily runs)"
    : !secret.startsWith("sb_secret_")
      ? "Should start with sb_secret_"
      : url
        ? await ping("/rest/v1/workspaces?select=id,daily_answer_limit&limit=1", secret).then((r) =>
            r.includes("daily_answer_limit") ? `${r}. Run supabase/002_daily_runs_and_limits.sql in the SQL Editor.` : r,
          )
        : "Set SUPABASE_URL first";
  // The newest database updates, checked by a table or column each one adds.
  if (url && secret) {
    const checks: [string, string][] = [
      ["031_report_style.sql", "/rest/v1/report_styles?select=workspace_id&limit=1"],
      ["032_oauth.sql", "/rest/v1/api_keys?select=refresh_hash,client_id&limit=1"],
      ["033_bulk_runs.sql", "/rest/v1/bulk_runs?select=id&limit=1"],
      ["034_settings.sql", "/rest/v1/profiles?select=id,avatar&limit=1"],
      ["035_notifications.sql", "/rest/v1/notification_prefs?select=weekly&limit=1"],
    ];
    report.migrations = Object.fromEntries(
      await Promise.all(
        checks.map(async ([file, path]) => {
          const r = await ping(path, secret);
          return [file, r === "OK" ? "Done" : `Not run yet. Open Supabase → SQL Editor and run supabase/${file}.`];
        }),
      ),
    );
  }
  report.CRON_SECRET = process.env.CRON_SECRET?.trim() ? "Set" : "MISSING (needed for daily runs)";

  const on = availableEngines();
  report.engines = Object.fromEntries(
    ENGINES.map((e) => [e, !on.includes(e) ? "Off (key missing)" : viaDfs(e) ? "On, through DataForSEO" : "On, through its own API"]),
  );

  if (process.env.DFS_LOGIN && process.env.DFS_PASSWORD) {
    try {
      const auth = Buffer.from(`${process.env.DFS_LOGIN.trim()}:${process.env.DFS_PASSWORD.trim()}`).toString("base64");
      const res = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
        headers: { Authorization: `Basic ${auth}` },
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json().catch(() => null);
      const balance = data?.tasks?.[0]?.result?.[0]?.money?.balance;
      report.DataForSEO =
        res.ok && data?.status_code === 20000 ? `OK, balance $${balance ?? "?"}` : `Failed (${res.status}): ${data?.status_message ?? "check DFS_LOGIN and DFS_PASSWORD"}`;
    } catch (e) {
      report.DataForSEO = `Could not reach DataForSEO: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    report.DataForSEO = "MISSING DFS_LOGIN and DFS_PASSWORD (needed for Google AI Overview)";
  }
  // Website tracking: which Umami the server will use, and whether it answers.
  const umamiKey = process.env.UMAMI_API_KEY?.trim();
  const own = process.env.UMAMI_URL?.trim();
  if (!umamiKey && !own) {
    report.Umami = "MISSING UMAMI_API_KEY (needed for AI traffic)";
  } else {
    try {
      const res = own
        ? await fetch(`${own.replace(/\/+$/, "")}/api/heartbeat`, { signal: AbortSignal.timeout(10_000) })
        : await fetch("https://api.umami.is/v1/websites?pageSize=1", { headers: { "x-umami-api-key": umamiKey!, Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
      report.Umami = res.ok
        ? `OK, ${own ? "self-hosted at " + own : "Umami Cloud"}`
        : `Failed (${res.status}): ${(await res.text()).slice(0, 150)}${own ? "" : ". Check the key, and that your Umami Cloud plan includes API access."}`;
    } catch (e) {
      report.Umami = `Could not reach Umami: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return Response.json(report);
}
