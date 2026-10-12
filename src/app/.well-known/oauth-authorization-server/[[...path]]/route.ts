import { originOf } from "@/lib/mcp/server";
import { OAUTH_CORS, SCOPE } from "@/lib/oauth";

// OAuth server details for MCP clients: where to register, sign in and get tokens.
export function GET(request: Request) {
  const origin = originOf(request);
  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
      service_documentation: "https://arrowsterr.com",
    },
    { headers: { ...OAUTH_CORS, "Cache-Control": "public, max-age=3600" } },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: OAUTH_CORS });
}
