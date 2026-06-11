import { describe, expect, test, beforeEach, afterEach, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodexIdentity, codexUsage, fetchCodexUsage, codexUsageSmart } from "../providers/codex";

function fakeIdToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(claims)}.signature`;
}

let tmp: string;
let codexDir: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skipper-test-"));
  codexDir = join(tmp, ".codex");
  mkdirSync(codexDir, { recursive: true });
  process.env.SKIPPER_CODEX_HOME = codexDir;
});
afterEach(() => {
  delete process.env.SKIPPER_CODEX_HOME;
  rmSync(tmp, { recursive: true, force: true });
});

function writeAuth(dir: string, claims: Record<string, unknown>) {
  writeFileSync(
    join(dir, "auth.json"),
    JSON.stringify({ auth_mode: "chatgpt", tokens: { id_token: fakeIdToken(claims) } }),
  );
}

describe("readCodexIdentity", () => {
  test("decodes email and plan from the id_token JWT", () => {
    writeAuth(codexDir, {
      email: "user@example.com",
      "https://api.openai.com/auth": { chatgpt_plan_type: "pro" },
    });
    expect(readCodexIdentity(null)).toEqual({ email: "user@example.com", tier: "pro" });
  });

  test("missing auth.json or malformed token yields nulls", () => {
    expect(readCodexIdentity(null)).toEqual({ email: null, tier: null });
    writeFileSync(join(codexDir, "auth.json"), JSON.stringify({ tokens: { id_token: "junk" } }));
    expect(readCodexIdentity(null)).toEqual({ email: null, tier: null });
  });

  test("reads from an explicit profile dir", () => {
    const dir = join(tmp, "profiles", "cx");
    mkdirSync(dir, { recursive: true });
    writeAuth(dir, { email: "b@c.com", "https://api.openai.com/auth": {} });
    expect(readCodexIdentity(dir)).toEqual({ email: "b@c.com", tier: null });
  });
});

describe("codexUsage", () => {
  const NOW = 1781140000_000;

  function writeRollout(relPath: string, lines: string[]) {
    const full = join(codexDir, "sessions", relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, lines.join("\n") + "\n");
  }

  test("needs login when auth.json is absent", () => {
    expect(codexUsage(null, NOW).error).toBe("needs login");
  });

  test("parses the newest rate_limits snapshot into 5h/7d windows", () => {
    writeAuth(codexDir, { email: "u@e.com" });
    writeRollout("2026/06/11/rollout-2026-06-11T10-00-00-abc.jsonl", [
      JSON.stringify({ type: "other", payload: {} }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          rate_limits: {
            primary: { used_percent: 82.0, window_minutes: 300, resets_at: 1781150000 },
            secondary: { used_percent: 13.0, window_minutes: 10080, resets_at: 1781737000 },
          },
        },
      }),
    ]);
    const snap = codexUsage(null, NOW);
    expect(snap.error).toBeUndefined();
    expect(snap.windows.five_hour.utilization).toBe(82);
    expect(snap.windows.five_hour.resetsAt).toBe(new Date(1781150000 * 1000).toISOString());
    expect(snap.windows.seven_day.utilization).toBe(13);
  });

  test("newest file wins; tolerates garbage lines", () => {
    writeAuth(codexDir, { email: "u@e.com" });
    writeRollout("2026/06/10/rollout-2026-06-10T09-00-00-old.jsonl", [
      JSON.stringify({ payload: { rate_limits: { primary: { used_percent: 99, window_minutes: 300, resets_at: 1781141000 } } } }),
    ]);
    writeRollout("2026/06/11/rollout-2026-06-11T11-00-00-new.jsonl", [
      "{not json",
      JSON.stringify({ payload: { rate_limits: { primary: { used_percent: 5, window_minutes: 300, resets_at: 1781150000 } } } }),
    ]);
    expect(codexUsage(null, NOW).windows.five_hour.utilization).toBe(5);
  });

  test("no rollouts yet points at running codex once", () => {
    writeAuth(codexDir, { email: "u@e.com" });
    expect(codexUsage(null, NOW).error).toBe("no usage yet (run codex once)");
  });
});

describe("fetchCodexUsage (network)", () => {
  const SOCK = `/tmp/skipper-codex-test-${process.pid}.sock`;
  try { unlinkSync(SOCK); } catch {}

  let refreshCount = 0;
  const server = Bun.serve({
    unix: SOCK,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/backend-api/wham/usage") {
        if (req.headers.get("authorization") !== "Bearer good-at") {
          return new Response("{}", { status: 401 });
        }
        if (req.headers.get("chatgpt-account-id") !== "acct-1") {
          return new Response("{}", { status: 400 });
        }
        return Response.json({
          plan_type: "pro",
          rate_limit: {
            primary_window: { used_percent: 31, reset_at: 1781150000, limit_window_seconds: 18000 },
            secondary_window: { used_percent: 7, reset_at: 1781737000, limit_window_seconds: 604800 },
          },
        });
      }
      if (url.pathname === "/oauth/token") {
        refreshCount++;
        const body = await req.json();
        if (body.refresh_token === "dead-rt") return new Response("{}", { status: 401 });
        return Response.json({ access_token: "good-at", refresh_token: "rt-2", id_token: "id-2" });
      }
      return new Response("nope", { status: 404 });
    },
  });
  afterAll(() => {
    server.stop(true);
    try { unlinkSync(SOCK); } catch {}
  });
  const unixFetch = ((url: string, init?: RequestInit) =>
    fetch(url, { ...(init ?? {}), unix: SOCK } as RequestInit & { unix: string })) as typeof fetch;
  const deps = {
    fetchFn: unixFetch,
    usageUrl: "http://codex.test/backend-api/wham/usage",
    tokenUrl: "http://codex.test/oauth/token",
  };

  function writeNetAuth(over: Record<string, unknown> = {}) {
    writeFileSync(join(codexDir, "auth.json"), JSON.stringify({
      tokens: { access_token: "good-at", refresh_token: "rt-1", account_id: "acct-1" },
      last_refresh: new Date().toISOString(),
      ...over,
    }));
  }

  test("fresh token fetches live windows without sessions on disk", async () => {
    writeNetAuth();
    const snap = await fetchCodexUsage(null, deps);
    expect(snap.windows.five_hour.utilization).toBe(31);
    expect(snap.windows.seven_day.utilization).toBe(7);
    expect(snap.windows.five_hour.resetsAt).toBe(new Date(1781150000 * 1000).toISOString());
  });

  test("401 triggers a refresh, retry, and auth.json write-back", async () => {
    writeNetAuth({ tokens: { access_token: "stale-at", refresh_token: "rt-1", account_id: "acct-1" } });
    refreshCount = 0;
    const snap = await fetchCodexUsage(null, deps);
    expect(refreshCount).toBe(1);
    expect(snap.windows.five_hour.utilization).toBe(31);
    const saved = JSON.parse(readFileSync(join(codexDir, "auth.json"), "utf8"));
    expect(saved.tokens.access_token).toBe("good-at");
    expect(saved.tokens.refresh_token).toBe("rt-2");
    expect(saved.tokens.account_id).toBe("acct-1"); // preserved
    expect(saved.last_refresh).toBeTruthy();
  });

  test("dead refresh token surfaces as a throw", async () => {
    writeNetAuth({ tokens: { access_token: "stale-at", refresh_token: "dead-rt", account_id: "acct-1" } });
    await expect(fetchCodexUsage(null, deps)).rejects.toThrow();
  });

  test("codexUsageSmart falls back to the rollout snapshot when offline", async () => {
    writeNetAuth();
    mkdirSync(join(codexDir, "sessions"), { recursive: true });
    writeFileSync(
      join(codexDir, "sessions", "rollout-x.jsonl"),
      JSON.stringify({ payload: { rate_limits: { primary: { used_percent: 64, window_minutes: 300, resets_at: 1781150000 } } } }) + "\n",
      { flag: "w" },
    );
    const offline = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    const snap = await codexUsageSmart(null, { ...deps, fetchFn: offline });
    expect(snap.windows.five_hour.utilization).toBe(64);
  });
});
