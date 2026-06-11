import type { OauthCreds } from "../../types";

export const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
// Claude Code's own public OAuth client id (the same one the official CLI
// sends) - an app identifier, not a user secret.
export const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const OAUTH_SCOPE =
  "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
export const BETA_HEADER = "oauth-2025-04-20";
/** Endpoints reject generic user agents; present as Claude Code. */
export const CLAUDE_UA = "claude-code/2.1.172";

/** Treat tokens expiring within 60s as expired so we never race the deadline. */
export function isExpired(creds: OauthCreds, now = Date.now()): boolean {
  return creds.expiresAt - now < 60_000;
}

export async function refreshTokens(
  creds: OauthCreds,
  fetchFn: typeof fetch = fetch,
  tokenUrl: string = TOKEN_URL,
): Promise<OauthCreds> {
  const res = await fetchFn(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-beta": BETA_HEADER,
      "User-Agent": CLAUDE_UA,
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: creds.refreshToken,
      client_id: CLIENT_ID,
      scope: OAUTH_SCOPE,
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    ...creds,
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? creds.refreshToken,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
}
