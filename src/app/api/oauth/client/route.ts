import { adminClient } from "@/lib/serverAuth";

// The approval screen asks which app is asking, and checks where it wants to send the person back.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("client_id") ?? "";
  const redirect = url.searchParams.get("redirect_uri") ?? "";
  const db = adminClient();
  const { data } = db && id ? await db.from("oauth_clients").select("name, redirect_uris").eq("id", id).maybeSingle() : { data: null };
  if (!data) return Response.json({ error: "This app is not registered. Start the connection again from the app." }, { status: 404 });
  if (!(data.redirect_uris as string[]).includes(redirect)) return Response.json({ error: "This app sent a return address it did not register." }, { status: 400 });
  return Response.json({ name: data.name, host: (() => { try { return new URL(redirect).host || redirect; } catch { return redirect; } })() });
}
