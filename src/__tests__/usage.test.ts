import { describe, expect, test, beforeEach, afterEach, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUsage, fetchUsage, getProfileUsage, mergeSnapshot } from "../usage";
import { credBlob } from "../providers/claude/credentials";
import { BETA_HEADER, CLAUDE_UA } from "../providers/claude/oauth";
import type { Profile, UsageSnapshot } from "../types";

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
let refreshCalls = 0;
let rotateOnRevoked: (() => void) | null = null;
let rotateOnRefreshFail: (() => void) | null = null;
const server = Bun.serve({
  unix: SOCK,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/oauth/usage") {
      if (req.headers.get("authorization") === "Bearer revoked-at" && rotateOnRevoked) {
        const rotate = rotateOnRevoked;
        rotateOnRevoked = null;
        rotate(); // simulate another process rotating creds in the store
      }
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
      refreshCalls++;
      const body = await req.json();
      if (body.refresh_token === "race-rt") {
        rotateOnRefreshFail?.();
        rotateOnRefreshFail = null;
        return new Response("{}", { status: 401 });
      }
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
    const { readCreds } = await import("../providers/claude/credentials");
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

describe("auth-failure self-repair", () => {
  let tmp2: string;
  let profile2: Profile;
  beforeEach(() => {
    usageStatus = 200;
    tmp2 = mkdtempSync(join(tmpdir(), "skipper-test-"));
    process.env.SKIPPER_CLAUDE_HOME = join(tmp2, ".claude");
    const dir = join(tmp2, "profiles", "repair");
    mkdirSync(dir, { recursive: true });
    profile2 = { name: "repair", configDir: dir, meta: { agent: "claude", createdAt: "" } };
  });
  afterEach(() => {
    delete process.env.SKIPPER_CLAUDE_HOME;
    rmSync(tmp2, { recursive: true, force: true });
  });

  function writeCredsFile(accessToken: string, refreshToken = "good-rt") {
    writeFileSync(
      join(profile2.configDir!, ".credentials.json"),
      credBlob({ accessToken, refreshToken, expiresAt: Date.now() + 3600_000 }),
    );
  }

  test("401 with unexpired token: re-reads the store and retries with rotated creds", async () => {
    writeCredsFile("revoked-at"); // valid expiry, but the server will 401 it
    rotateOnRevoked = () => writeCredsFile("fresh-at"); // another process rotates mid-flight
    refreshCalls = 0;
    const snap = await getProfileUsage(profile2, { fetchFn: unixFetch, usageUrl, tokenUrl });
    rotateOnRevoked = null;
    expect(snap.error).toBeUndefined();
    expect(snap.windows.five_hour.utilization).toBe(4.0);
    expect(refreshCalls).toBe(0); // repaired by re-read alone - never touched the refresh endpoint
  });

  test("failed refresh during a rotation race re-reads the store (repair 3)", async () => {
    writeCredsFile("revoked-at", "race-rt"); // refresh will 401, rotating the store as it fails
    rotateOnRefreshFail = () => writeCredsFile("fresh-at");
    const snap = await getProfileUsage(profile2, { fetchFn: unixFetch, usageUrl, tokenUrl });
    expect(snap.error).toBeUndefined();
    expect(snap.windows.five_hour.utilization).toBe(4.0);
  });

  test("401 with no rotation falls back to a forced refresh and retry", async () => {
    writeCredsFile("revoked-at");
    refreshCalls = 0;
    const snap = await getProfileUsage(profile2, { fetchFn: unixFetch, usageUrl, tokenUrl });
    expect(refreshCalls).toBe(1);
    expect(snap.windows.five_hour.utilization).toBe(4.0);
    const { readCreds } = await import("../providers/claude/credentials");
    expect((await readCreds(profile2.configDir))!.creds.accessToken).toBe("fresh-at");
  });
});

describe("mergeSnapshot keep-last-good", () => {
  const good: UsageSnapshot = {
    fetchedAt: 100,
    windows: { five_hour: { utilization: 40, resetsAt: "2026-06-12T00:00:00Z" } },
  };
  test("transient failure keeps previous numbers marked stale", () => {
    const merged = mergeSnapshot(good, { fetchedAt: 200, windows: {}, error: "usage unavailable" });
    expect(merged.windows.five_hour.utilization).toBe(40);
    expect(merged.stale).toBe(true);
    expect(merged.error).toBeUndefined();
  });
  test("needs login always surfaces", () => {
    const merged = mergeSnapshot(good, { fetchedAt: 200, windows: {}, error: "needs login" });
    expect(merged.error).toBe("needs login");
  });
  test("success replaces and clears staleness", () => {
    const next: UsageSnapshot = { fetchedAt: 300, windows: { five_hour: { utilization: 50, resetsAt: "x" } } };
    expect(mergeSnapshot({ ...good, stale: true }, next)).toEqual(next);
  });
  test("error with no previous data passes through", () => {
    const err: UsageSnapshot = { fetchedAt: 1, windows: {}, error: "usage unavailable" };
    expect(mergeSnapshot(undefined, err)).toEqual(err);
  });
});
