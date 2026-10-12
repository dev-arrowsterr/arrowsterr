import { CORS, handleMcp } from "@/lib/mcp/server";

// Arrowsterr's MCP server. Add https://app.arrowsterr.com/api/mcp to Claude, ChatGPT, Cursor or any MCP client.
// Sign in with OAuth (Claude.ai connectors) or send an API key from Settings → Integrations.
export const POST = handleMcp;

// No server-sent event stream: every reply comes back on the POST.
export function GET() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
