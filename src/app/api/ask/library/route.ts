import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import * as cheerio from "cheerio";
import { skillsOf } from "@/lib/ask";
import { BUILTIN_SKILLS } from "@/lib/zippieSkills";
import { adminClient, requireRole } from "@/lib/serverAuth";

export const maxDuration = 60;

const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const err = (error: string, status = 400) => Response.json({ error }, { status });
const MAX_CHARS = 400_000;
const SETUP = "Run supabase/037_zippie.sql in Supabase to turn on projects, knowledge and skills.";

/** Block addresses inside private networks, so a pasted link can't reach the server's own network. */
function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) return ip === "::1" || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || (ip.startsWith("::ffff:") && privateIp(ip.slice(7)));
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function readUrl(raw: string): Promise<{ name: string; text: string }> {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("That doesn't look like a link.");
  }
  // Follow redirects by hand, checking each address.
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw new Error("Only web links work here.");
    const { address } = await lookup(url.hostname).catch(() => ({ address: "" }));
    if (!address || privateIp(address)) throw new Error("Can't read that address.");
    res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ArrowsterrBot/1.0; +https://arrowsterr.com/)" }, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) break;
    url = new URL(next, url);
  }
  if (!res || !res.ok) throw new Error(`That page answered ${res?.status ?? "nothing"}.`);
  const html = (await res.text()).slice(0, 3_000_000);
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, header, form, iframe").remove();
  const name = $("title").first().text().trim() || url.hostname + url.pathname;
  const text = ($("main").text() || $("body").text()).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  return { name, text };
}

async function readPdf(base64: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(base64, "base64")));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text).replace(/[ \t]+/g, " ").trim();
}

// Zippie's library: projects that group chats, knowledge that teaches him, and skills.
//   list: {}                                                 viewers
//   project_save: { id?, name, instructions }   project_delete: { id }                editors
//   knowledge_add: { kind: file|url|note, name, content?, pdf?, url?, projectId? }      editors
//   knowledge_delete: { id }                                                            editors
//   skill_save: { id?, name, description, instructions }   skill_toggle: { key, enabled }   skill_delete: { id }   editors
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireRole(request, body.workspaceId, body.action === "list" ? "viewer" : "editor");
  if ("denied" in auth) return auth.denied;
  const db = adminClient();
  if (!db) return err("Add SUPABASE_SECRET_KEY to the server's settings.", 500);
  const ws = String(body.workspaceId);
  const { data: me } = await auth.sb.auth.getUser();
  const userId = me.user?.id ?? null;
  const missing = (e: { message: string } | null) => e && /ask_projects|ask_knowledge|ask_skills|project_id/.test(e.message);

  if (body.action === "list") {
    const [projects, knowledge] = await Promise.all([
      db.from("ask_projects").select("id, name, instructions, updated_at").eq("workspace_id", ws).order("updated_at", { ascending: false }),
      db.from("ask_knowledge").select("id, kind, name, source, chars, project_id, created_at").eq("workspace_id", ws).order("created_at", { ascending: false }),
    ]);
    if (missing(projects.error) || missing(knowledge.error)) return Response.json({ projects: [], knowledge: [], skills: BUILTIN_SKILLS.map((s) => ({ ...s, builtin: true, enabled: true })), setup: SETUP });
    if (projects.error || knowledge.error) return err((projects.error ?? knowledge.error)!.message, 500);
    return Response.json({ projects: projects.data, knowledge: knowledge.data, skills: await skillsOf(db, ws) });
  }

  if (body.action === "project_save") {
    const name = str(body.name, 80);
    if (!name) return err("Name the project.");
    const row = { name, instructions: str(body.instructions, 8000), updated_at: new Date().toISOString() };
    const q = body.id
      ? db.from("ask_projects").update(row).eq("id", str(body.id, 60)).eq("workspace_id", ws)
      : db.from("ask_projects").insert({ ...row, workspace_id: ws, created_by: userId });
    const { data, error } = await q.select("id, name, instructions, updated_at").single();
    if (missing(error)) return err(SETUP, 500);
    if (error) return err(error.message, 500);
    return Response.json({ project: data });
  }

  if (body.action === "project_delete") {
    // Its chats stay, outside any project. Its knowledge goes with it.
    const { error } = await db.from("ask_projects").delete().eq("id", str(body.id, 60)).eq("workspace_id", ws);
    if (error) return err(error.message, 500);
    return Response.json({ ok: true });
  }

  if (body.action === "knowledge_add") {
    const kind = body.kind === "url" ? "url" : body.kind === "note" ? "note" : "file";
    let name = str(body.name, 200);
    let content = "";
    let source = "";
    try {
      if (kind === "url") {
        source = str(body.url, 2000);
        const page = await readUrl(source);
        name = name || page.name;
        content = page.text;
      } else if (kind === "file" && body.pdf) {
        if (String(body.pdf).length > 14_000_000) return err("That PDF is too big. Keep files under 10 MB.");
        content = await readPdf(String(body.pdf));
        source = name;
      } else {
        content = String(body.content ?? "");
        source = kind === "file" ? name : "";
      }
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }
    content = content.replace(/\u0000/g, "").trim();
    if (!content) return err(kind === "file" ? "Couldn't find any text in that file." : "Add some text first.");
    if (!name) name = content.slice(0, 50);
    let projectId: string | null = null;
    if (body.projectId) {
      const { data: p } = await db.from("ask_projects").select("id").eq("id", str(body.projectId, 60)).eq("workspace_id", ws).maybeSingle();
      if (!p) return err("Project not found.", 404);
      projectId = p.id;
    }
    const { data, error } = await db
      .from("ask_knowledge")
      .insert({ workspace_id: ws, project_id: projectId, kind, name, source, content: content.slice(0, MAX_CHARS), chars: Math.min(content.length, MAX_CHARS), created_by: userId })
      .select("id, kind, name, source, chars, project_id, created_at")
      .single();
    if (missing(error)) return err(SETUP, 500);
    if (error) return err(error.message, 500);
    return Response.json({ item: data, cut: content.length > MAX_CHARS });
  }

  if (body.action === "knowledge_delete") {
    const { error } = await db.from("ask_knowledge").delete().eq("id", str(body.id, 60)).eq("workspace_id", ws);
    if (error) return err(error.message, 500);
    return Response.json({ ok: true });
  }

  if (body.action === "skill_save") {
    const row = { name: str(body.name, 80), description: str(body.description, 300), instructions: str(body.instructions, 12_000) };
    if (!row.name || !row.instructions) return err("Give the skill a name and instructions.");
    const q = body.id ? db.from("ask_skills").update(row).eq("id", str(body.id, 60)).eq("workspace_id", ws).is("builtin", null) : db.from("ask_skills").insert({ ...row, workspace_id: ws, created_by: userId });
    const { error } = await q;
    if (missing(error)) return err(SETUP, 500);
    if (error) return err(error.message, 500);
    return Response.json({ skills: await skillsOf(db, ws) });
  }

  if (body.action === "skill_toggle") {
    const key = str(body.key, 80);
    const enabled = Boolean(body.enabled);
    const builtin = BUILTIN_SKILLS.some((s) => s.key === key);
    const { error } = builtin
      ? await db.from("ask_skills").upsert({ workspace_id: ws, builtin: key, enabled, created_by: userId }, { onConflict: "workspace_id,builtin" })
      : await db.from("ask_skills").update({ enabled }).eq("id", key).eq("workspace_id", ws);
    if (missing(error)) return err(SETUP, 500);
    if (error) return err(error.message, 500);
    return Response.json({ skills: await skillsOf(db, ws) });
  }

  if (body.action === "skill_delete") {
    const { error } = await db.from("ask_skills").delete().eq("id", str(body.id, 60)).eq("workspace_id", ws).is("builtin", null);
    if (error) return err(error.message, 500);
    return Response.json({ skills: await skillsOf(db, ws) });
  }

  return err("Unknown action.");
}
