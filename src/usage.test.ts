import { describe, expect, test, beforeEach, afterEach, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUsage, fetchUsage, getProfileUsage } from "./usage";
import { credBlob } from "./credentials";
import { BETA_HEADER, CLAUDE_UA } from "./oauth";
import type { Profile } from "./types";

describe("parseUsage", () => {
  test("keeps window-shaped keys, drops the rest", () => {
    const parsed = parseUsage({
      five_hour: { utilization: 92.0, resets_at: "2026-06-11T05:00:00Z" },
      seven_day: { utilization: 71.0, resets_at: "2026-06-13T05:00:00Z" },
      seven_day_opus: { utilization: 12.5, resets_at: "2026-06-13T05:00:00Z" },
      extra_usage: { enabled: true },
      some_string: "x",
    });
    expect(Object.keys(parsed).sort()).toEqual(["five_hour", "seven_day", "seven_day_opus"]);
    expect(parsed.five_hour).toEqual({ utilization: 92.0, resetsAt: "2026-06-11T05:00:00Z" });
  });
  test("non-object input yields no windows", () => {
    expect(parseUsage(null)).toEqual({});
    expect(parseUsage("nope")).toEqual({});
  });
});

// Mock server covering usage + token refresh.
// Socket Firewall on this machine intercepts localhost TCP; use Unix socket instead.
const SOCK = `/tmp/skipper-usage-test-${process.pid}.sock`;
try { unlinkSync(SOCK); } catch {}

let usageStatus = 200;
const server = Bun.serve({
  unix: SOCK,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/oauth/usage") {
      if (req.headers.get("authorization") !== "Bearer fresh-at") {
        return new Response("{}", { status: 401 });
      }
      if (usageStatus !== 200) return new Response("{}", { status: usageStatus });
      // assert headers on the happy path
      if (
        req.headers.get("anthropic-beta") !== BETA_HEADER ||
        req.headers.get("user-agent") !== CLAUDE_UA
      ) {
        return new Response("{}", { status: 400 });
      }
      return Response.json({
        five_hour: { utilization: 4.0, resets_at: "2026-06-11T05:00:00Z" },
        seven_day: { utilization: 12.0, resets_at: "2026-06-16T09:00:00Z" },
      });
    }
    if (url.pathname === "/v1/oauth/token") {
      const body = await req.json();
      if (body.refresh_token === "dead-rt") return new Response("{}", { status: 401 });
      return Response.json({ access_token: "fresh-at", refresh_token: "rt-2", expires_in: 3600 });
    }
    return new Response("not found", { status: 404 });
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

const usageUrl = `http://localhost/api/oauth/usage`;
const tokenUrl = `http://localhost/v1/oauth/token`;

describe("fetchUsage", () => {
  test("sends auth + beta + UA headers and parses", async () => {
    const windows = await fetchUsage("fresh-at", unixFetch, usageUrl);
    expect(windows.five_hour.utilization).toBe(4.0);
    expect(windows.seven_day.resetsAt).toBe("2026-06-16T09:00:00Z");
  });
  test("non-200 throws", async () => {
    await expect(fetchUsage("wrong-at", unixFetch, usageUrl)).rejects.toThrow("401");
  });
});

describe("getProfileUsage", () => {
  let tmp: string;
  let profile: Profile;
  beforeEach(() => {
    usageStatus = 200;
    tmp = mkdtempSync(join(tmpdir(), "skipper-test-"));
    process.env.SKIPPER_CLAUDE_HOME = join(tmp, ".claude");
    const dir = join(tmp, "profiles", "work");
    mkdirSync(dir, { recursive: true });
    profile = { name: "work", configDir: dir, meta: { agent: "claude", createdAt: "" } };
  });
  afterEach(() => {
    delete process.env.SKIPPER_CLAUDE_HOME;
    rmSync(tmp, { recursive: true, force: true });
  });

  function writeProfileCreds(over: Partial<{ accessToken: string; refreshToken: string; expiresAt: number }> = {}) {
    writeFileSync(
      join(profile.configDir!, ".credentials.json"),
      credBlob({
        accessToken: over.accessToken ?? "stale-at",
        refreshToken: over.refreshToken ?? "good-rt",
        expiresAt: over.expiresAt ?? 0, // expired
      }),
    );
  }

  test("refreshes expired token, persists it, fetches usage", async () => {
    writeProfileCreds();
    const snap = await getProfileUsage(profile, { fetchFn: unixFetch, usageUrl, tokenUrl });
    expect(snap.error).toBeUndefined();
    expect(snap.windows.five_hour.utilization).toBe(4.0);
    // rotated tokens were written back
    const { readCreds } = await import("./credentials");
    const stored = await readCreds(profile.configDir);
    expect(stored!.creds.accessToken).toBe("fresh-at");
    expect(stored!.creds.refreshToken).toBe("rt-2");
  });

  test("valid token skips refresh", async () => {
    writeProfileCreds({ accessToken: "fresh-at", expiresAt: Date.now() + 3600_000 });
    const snap = await getProfileUsage(profile, { fetchFn: unixFetch, usageUrl, tokenUrl });
    expect(snap.windows.seven_day.utilization).toBe(12.0);
  });

  test("no creds → needs login", async () => {
    const snap = await getProfileUsage(profile, { fetchFn: unixFetch, usageUrl, tokenUrl });
    expect(snap.error).toBe("needs login");
  });

  test("dead refresh token → needs login", async () => {
    writeProfileCreds({ refreshToken: "dead-rt" });
    const snap = await getProfileUsage(profile, { fetchFn: unixFetch, usageUrl, tokenUrl });
    expect(snap.error).toBe("needs login");
  });

  test("usage endpoint failure → usage unavailable", async () => {
    writeProfileCreds({ accessToken: "fresh-at", expiresAt: Date.now() + 3600_000 });
    usageStatus = 500;
    const snap = await getProfileUsage(profile, { fetchFn: unixFetch, usageUrl, tokenUrl });
    expect(snap.error).toBe("usage unavailable");
  });
});
