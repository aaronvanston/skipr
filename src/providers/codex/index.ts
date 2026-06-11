import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { writeFileAtomic } from "../../fsutil";
import { join } from "node:path";
import type { Identity, UsageSnapshot, UsageWindow } from "../../types";
import { codexHome } from "../../paths";

function authPath(configDir: string | null): string {
  return join(configDir ?? codexHome(), "auth.json");
}

/** Email and plan live as claims inside auth.json's id_token JWT. The token
 * is only decoded in memory; nothing from it is logged or persisted. */
export function readCodexIdentity(configDir: string | null): Identity {
  try {
    const auth = JSON.parse(readFileSync(authPath(configDir), "utf8"));
    const idToken: string = auth?.tokens?.id_token ?? "";
    const [, payload] = idToken.split(".");
    if (!payload) return { email: null, tier: null };
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return {
      email: claims?.email ?? null,
      tier: claims?.["https://api.openai.com/auth"]?.chatgpt_plan_type ?? null,
    };
  } catch {
    return { email: null, tier: null };
  }
}

/** Codex writes a rate_limits snapshot into every session rollout; the
 * freshest one is the usage truth, no network needed. */
const WINDOW_KEYS: Record<number, string> = { 300: "five_hour", 10080: "seven_day" };

function windowFrom(raw: unknown): { key: string; window: UsageWindow } | null {
  const w = raw as { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown };
  if (!w || typeof w.used_percent !== "number" || typeof w.window_minutes !== "number") return null;
  const key = WINDOW_KEYS[w.window_minutes] ?? `${w.window_minutes}m`;
  const resetsAt =
    typeof w.resets_at === "number" ? new Date(w.resets_at * 1000).toISOString() : "";
  return { key, window: { utilization: w.used_percent, resetsAt } };
}

/** Newest-first rollout files for a codex home. Filenames embed timestamps,
 * so a reverse name sort is a chronological sort. */
function rolloutFiles(dir: string, limit = 5): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: string[];
    try {
      entries = readdirSync(d).sort().reverse();
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= limit) return;
      const full = join(d, name);
      try {
        if (statSync(full).isDirectory()) walk(full);
        else if (name.startsWith("rollout-") && name.endsWith(".jsonl")) out.push(full);
      } catch {
        // unreadable entry, skip
      }
    }
  };
  walk(dir);
  return out;
}

/** Read at most the trailing `cap` bytes of a file (rollouts can be large;
 * the snapshot we want is near the end). */
function tail(path: string, cap = 262_144): string {
  const fd = openSync(path, "r");
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - cap);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export function codexUsage(configDir: string | null, fetchedAt = Date.now()): UsageSnapshot {
  if (!existsSync(authPath(configDir))) {
    return { fetchedAt, windows: {}, error: "needs login" };
  }
  const sessionsDir = join(configDir ?? codexHome(), "sessions");
  for (const file of rolloutFiles(sessionsDir)) {
    const lines = tail(file).split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes("rate_limits")) continue;
      try {
        const entry = JSON.parse(lines[i]);
        const limits = entry?.payload?.rate_limits ?? entry?.rate_limits;
        const windows: Record<string, UsageWindow> = {};
        for (const part of [limits?.primary, limits?.secondary]) {
          const parsed = windowFrom(part);
          if (parsed) windows[parsed.key] = parsed.window;
        }
        if (Object.keys(windows).length > 0) return { fetchedAt, windows };
      } catch {
        // partial/garbled line, keep scanning backwards
      }
    }
  }
  return { fetchedAt, windows: {}, error: "no usage yet (run codex once)" };
}

// --- Network usage (primary source): the same ChatGPT backend endpoint the
// Codex CLI and CodexBar use. Fresh data with zero sessions on disk; the
// rollout snapshot above remains the offline fallback.
export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
/** Codex CLI's public OAuth client id (an app identifier, not a user secret). */
export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";

interface CodexAuth {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
  [key: string]: unknown;
}

function readAuth(configDir: string | null): CodexAuth | null {
  try {
    return JSON.parse(readFileSync(authPath(configDir), "utf8"));
  } catch {
    return null;
  }
}

export interface CodexUsageDeps {
  fetchFn?: typeof fetch;
  usageUrl?: string;
  tokenUrl?: string;
}

function apiWindow(raw: unknown): { key: string; window: UsageWindow } | null {
  const w = raw as { used_percent?: unknown; reset_at?: unknown; limit_window_seconds?: unknown };
  if (!w || typeof w.used_percent !== "number") return null;
  const minutes = typeof w.limit_window_seconds === "number" ? w.limit_window_seconds / 60 : 0;
  const key = WINDOW_KEYS[minutes] ?? `${minutes}m`;
  const resetsAt = typeof w.reset_at === "number" ? new Date(w.reset_at * 1000).toISOString() : "";
  return { key, window: { utilization: w.used_percent, resetsAt } };
}

/** Tokens older than 8 days need a refresh first (mirrors CodexBar). */
function needsRefresh(auth: CodexAuth): boolean {
  const last = Date.parse(auth.last_refresh ?? "");
  return Number.isNaN(last) || Date.now() - last > 8 * 24 * 3600_000;
}

async function refreshCodexTokens(
  configDir: string | null,
  auth: CodexAuth,
  fetchFn: typeof fetch,
  tokenUrl: string,
): Promise<CodexAuth> {
  const refreshToken = auth.tokens?.refresh_token;
  if (!refreshToken) throw new Error("no refresh token");
  const res = await fetchFn(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "openid profile email",
    }),
  });
  if (!res.ok) throw new Error(`codex token refresh failed: HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, string | undefined>;
  const updated: CodexAuth = {
    ...auth,
    tokens: {
      ...auth.tokens,
      access_token: json.access_token ?? auth.tokens?.access_token,
      refresh_token: json.refresh_token ?? refreshToken,
      id_token: json.id_token ?? auth.tokens?.id_token,
    },
    last_refresh: new Date().toISOString(),
  };
  writeFileAtomic(authPath(configDir), JSON.stringify(updated, null, 2), 0o600);
  return updated;
}

/** Live usage straight from the backend; throws on any failure so callers
 * can fall back to the rollout snapshot. */
export async function fetchCodexUsage(
  configDir: string | null,
  deps: CodexUsageDeps = {},
): Promise<UsageSnapshot> {
  const { fetchFn = fetch, usageUrl = CODEX_USAGE_URL, tokenUrl = CODEX_TOKEN_URL } = deps;
  let auth = readAuth(configDir);
  if (!auth?.tokens?.access_token) throw new Error("no codex auth");
  if (needsRefresh(auth)) {
    try {
      auth = await refreshCodexTokens(configDir, auth, fetchFn, tokenUrl);
    } catch {
      // stale-but-maybe-valid token: let the usage call decide
    }
  }
  const get = (token: string) =>
    fetchFn(usageUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "skipr",
        ...(auth?.tokens?.account_id ? { "ChatGPT-Account-Id": auth.tokens.account_id } : {}),
      },
    });
  const accessToken = auth.tokens?.access_token;
  if (!accessToken) throw new Error("no codex access token");
  let res = await get(accessToken);
  if (res.status === 401 || res.status === 403) {
    auth = await refreshCodexTokens(configDir, auth, fetchFn, tokenUrl);
    const refreshed = auth.tokens?.access_token;
    if (!refreshed) throw new Error("codex refresh returned no access token");
    res = await get(refreshed);
  }
  if (!res.ok) throw new Error(`codex usage failed: HTTP ${res.status}`);
  const json = (await res.json()) as { rate_limit?: { primary_window?: unknown; secondary_window?: unknown } };
  const windows: Record<string, UsageWindow> = {};
  for (const part of [json.rate_limit?.primary_window, json.rate_limit?.secondary_window]) {
    const parsed = apiWindow(part);
    if (parsed) windows[parsed.key] = parsed.window;
  }
  if (Object.keys(windows).length === 0) throw new Error("codex usage: no windows in response");
  return { fetchedAt: Date.now(), windows };
}

/** Network first, rollout snapshot as the offline fallback. */
export async function codexUsageSmart(
  configDir: string | null,
  deps: CodexUsageDeps = {},
): Promise<UsageSnapshot> {
  try {
    return await fetchCodexUsage(configDir, deps);
  } catch {
    return codexUsage(configDir);
  }
}
