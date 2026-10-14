// Fly checks this to decide when a deploy is live (fly.toml).
export function GET() {
  return Response.json({ ok: true });
}
