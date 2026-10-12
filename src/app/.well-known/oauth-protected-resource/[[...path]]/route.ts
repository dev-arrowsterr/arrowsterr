import { originOf } from "@/lib/mcp/server";
import { OAUTH_CORS, SCOPE } from "@/lib/oauth";

// Tells MCP clients that /api/mcp takes OAuth tokens from Arrowsterr. Also served at /.well-known/oauth-protected-resource/api/mcp.
export function GET(request: Request) {
  const origin = originOf(request);
  return Response.json(
    { resource: `${origin}/api/mcp`, authorization_servers: [origin], scopes_supported: [SCOPE], bearer_methods_supported: ["header"], resource_name: "Arrowsterr", resource_documentation: "https://arrowsterr.com" },
    { headers: { ...OAUTH_CORS, "Cache-Control": "public, max-age=3600" } },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}
