// Every read and write the app makes. Row level security in Supabase decides what each person may do.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Chat, Run } from "./chats";

export type Role = "owner" | "admin" | "editor" | "viewer";
export const ROLE_RANK: Record<Role, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };
export const atLeast = (role: Role | undefined, min: Role) => (role ? ROLE_RANK[role] >= ROLE_RANK[min] : false);

export type Workspace = { id: string; name: string; role: Role };
export type Brand = {
  id: string;
  workspace_id: string;
  url: string;
  domain: string;
  name: string;
  logo: string;
  category: string;
  prompts: string[];
};
export type SavedRun = Run & { id: string };
export type Member = { user_id: string; email: string | null; role: Role };
export type Invite = { id: string; email: string; role: Role; token: string; created_at: string };

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function listWorkspaces(sb: SupabaseClient, userId: string): Promise<Workspace[]> {
  const rows = check(
    await sb.from("workspace_members").select("role, workspaces(id, name)").eq("user_id", userId),
  ) as unknown as { role: Role; workspaces: { id: string; name: string } | null }[];
  return rows
    .filter((r) => r.workspaces)
    .map((r) => ({ id: r.workspaces!.id, name: r.workspaces!.name, role: r.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createWorkspace(sb: SupabaseClient, name: string): Promise<string> {
  return check(await sb.rpc("create_workspace", { p_name: name })) as string;
}

export async function renameWorkspace(sb: SupabaseClient, id: string, name: string) {
  check(await sb.from("workspaces").update({ name }).eq("id", id));
}

export async function acceptInvite(sb: SupabaseClient, token: string): Promise<string> {
  return check(await sb.rpc("accept_invite", { p_token: token })) as string;
}

export async function listBrands(sb: SupabaseClient, workspaceId: string): Promise<Brand[]> {
  return check(
    await sb.from("brands").select("id, workspace_id, url, domain, name, logo, category, prompts").eq("workspace_id", workspaceId).order("created_at"),
  ) as Brand[];
}

export async function addBrand(sb: SupabaseClient, b: Omit<Brand, "id">): Promise<Brand> {
  return check(await sb.from("brands").insert(b).select("id, workspace_id, url, domain, name, logo, category, prompts").single()) as Brand;
}

export async function saveBrand(sb: SupabaseClient, b: Brand) {
  check(await sb.from("brands").update({ name: b.name, prompts: b.prompts, category: b.category, logo: b.logo }).eq("id", b.id));
}

export async function deleteBrand(sb: SupabaseClient, id: string) {
  check(await sb.from("brands").delete().eq("id", id));
}

/** Runs from the last 180 days, oldest first. That covers every timeframe on the dashboard. */
export async function listRuns(sb: SupabaseClient, brandId: string): Promise<SavedRun[]> {
  const since = new Date(Date.now() - 180 * 864e5).toISOString();
  return check(
    await sb.from("runs").select("id, at, engines, chats").eq("brand_id", brandId).gte("at", since).order("at"),
  ) as SavedRun[];
}

/** Saved chats drop the long answer text to keep rows small. */
const slim = (chats: Chat[]) => chats.map((c) => ({ ...c, answered: c.answered ?? Boolean(c.text), text: "" }));

export async function startRun(sb: SupabaseClient, workspaceId: string, brandId: string, userId: string, run: Run): Promise<string> {
  const row = check(
    await sb
      .from("runs")
      .insert({ workspace_id: workspaceId, brand_id: brandId, created_by: userId, at: run.at, engines: run.engines, chats: [] })
      .select("id")
      .single(),
  ) as { id: string };
  return row.id;
}

export async function saveRunChats(sb: SupabaseClient, runId: string, chats: Chat[]) {
  check(await sb.from("runs").update({ chats: slim(chats) }).eq("id", runId));
}

export async function listMembers(sb: SupabaseClient, workspaceId: string): Promise<Member[]> {
  return check(await sb.from("workspace_members").select("user_id, email, role").eq("workspace_id", workspaceId).order("created_at")) as Member[];
}

export async function setMemberRole(sb: SupabaseClient, workspaceId: string, userId: string, role: Role) {
  check(await sb.from("workspace_members").update({ role }).eq("workspace_id", workspaceId).eq("user_id", userId));
}

export async function removeMember(sb: SupabaseClient, workspaceId: string, userId: string) {
  check(await sb.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("user_id", userId));
}

export async function listInvites(sb: SupabaseClient, workspaceId: string): Promise<Invite[]> {
  return check(
    await sb.from("workspace_invites").select("id, email, role, token, created_at").eq("workspace_id", workspaceId).is("accepted_at", null).order("created_at"),
  ) as Invite[];
}

export async function createInvite(sb: SupabaseClient, workspaceId: string, userId: string, email: string, role: Role): Promise<Invite> {
  return check(
    await sb
      .from("workspace_invites")
      .insert({ workspace_id: workspaceId, email: email.trim().toLowerCase(), role, invited_by: userId })
      .select("id, email, role, token, created_at")
      .single(),
  ) as Invite;
}

export async function revokeInvite(sb: SupabaseClient, id: string) {
  check(await sb.from("workspace_invites").delete().eq("id", id));
}
