// Railway pings this to decide when a deploy is live.
export function GET() {
  return Response.json({ ok: true });
}
