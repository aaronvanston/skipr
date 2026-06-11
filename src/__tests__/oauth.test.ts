import { describe, expect, test, afterAll } from "bun:test";
import { unlinkSync } from "node:fs";
import { refreshTokens, isExpired, CLAUDE_UA, BETA_HEADER } from "../providers/claude/oauth";
import type { OauthCreds } from "../types";

const CREDS: OauthCreds = {
  accessToken: "old-at",
  refreshToken: "old-rt",
  expiresAt: 1000,
  subscriptionType: "max",
};

// Socket Firewall on this machine intercepts localhost TCP; use Unix socket instead.
const SOCK = `/tmp/skipper-oauth-test-${process.pid}.sock`;
try { unlinkSync(SOCK); } catch {}

let lastRequest: { headers: Headers; body: any } | null = null;
const server = Bun.serve({
  unix: SOCK,
  async fetch(req) {
    lastRequest = { headers: req.headers, body: await req.json() };
    if (lastRequest.body.refresh_token === "dead-rt") {
      return new Response("{}", { status: 401 });
    }
    return Response.json({
      access_token: "new-at",
      refresh_token: "new-rt",
      expires_in: 3600,
    });
  },
});
afterAll(() => {
  server.stop(true);
  try { unlinkSync(SOCK); } catch {}
});

// Wrap fetch to route through the unix socket
function unixFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...(init ?? {}), unix: SOCK } as RequestInit & { unix: string });
}

const url = `http://localhost/v1/oauth/token`;

describe("isExpired", () => {
  test("expired and about-to-expire (<60s) count as expired", () => {
    expect(isExpired({ ...CREDS, expiresAt: Date.now() - 1 })).toBe(true);
    expect(isExpired({ ...CREDS, expiresAt: Date.now() + 30_000 })).toBe(true);
    expect(isExpired({ ...CREDS, expiresAt: Date.now() + 600_000 })).toBe(false);
  });
});

describe("refreshTokens", () => {
  test("posts the claudex-shaped body with required headers", async () => {
    const before = Date.now();
    const next = await refreshTokens(CREDS, unixFetch, url);
    expect(lastRequest!.body.grant_type).toBe("refresh_token");
    expect(lastRequest!.body.refresh_token).toBe("old-rt");
    expect(lastRequest!.body.client_id).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e");
    expect(lastRequest!.headers.get("anthropic-beta")).toBe(BETA_HEADER);
    expect(lastRequest!.headers.get("user-agent")).toBe(CLAUDE_UA);
    expect(next.accessToken).toBe("new-at");
    expect(next.refreshToken).toBe("new-rt");
    expect(next.expiresAt).toBeGreaterThanOrEqual(before + 3600_000);
    expect(next.subscriptionType).toBe("max"); // extra fields preserved
  });

  test("non-200 throws", async () => {
    await expect(
      refreshTokens({ ...CREDS, refreshToken: "dead-rt" }, unixFetch, url),
    ).rejects.toThrow("401");
  });
});
