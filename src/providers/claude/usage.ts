import type { UsageSnapshot, UsageWindow } from "../../types";
import { readCreds, writeCreds } from "./credentials";
import { BETA_HEADER, CLAUDE_UA, TOKEN_URL, isExpired, refreshTokens } from "./oauth";

export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

/** Keep any top-level key shaped like {utilization: number, resets_at: string}. */
export function parseUsage(json: unknown): Record<string, UsageWindow> {
  const windows: Record<string, UsageWindow> = {};
  if (json && typeof json === "object") {
    for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
      const v = value as { utilization?: unknown; resets_at?: unknown };
      if (v && typeof v.utilization === "number" && typeof v.resets_at === "string") {
        windows[key] = { utilization: v.utilization, resetsAt: v.resets_at };
      }
    }
  }
  return windows;
}

interface UsageAttempt {
  status: number;
  windows?: Record<string, UsageWindow>;
}

async function requestUsage(
  accessToken: string,
  fetchFn: typeof fetch,
  usageUrl: string,
): Promise<UsageAttempt> {
  const res = await fetchFn(usageUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Anthropic-Beta": BETA_HEADER,
      Accept: "application/json",
      "User-Agent": CLAUDE_UA,
    },
  });
  if (!res.ok) return { status: res.status };
  return { status: res.status, windows: parseUsage(await res.json()) };
}

export async function fetchUsage(
  accessToken: string,
  fetchFn: typeof fetch = fetch,
  usageUrl: string = USAGE_URL,
): Promise<Record<string, UsageWindow>> {
  const attempt = await requestUsage(accessToken, fetchFn, usageUrl);
  if (!attempt.windows) throw new Error(`usage fetch failed: HTTP ${attempt.status}`);
  return attempt.windows;
}

export interface UsageDeps {
  fetchFn?: typeof fetch;
  usageUrl?: string;
  tokenUrl?: string;
}

const isAuthFailure = (status: number) => status === 401 || status === 403;

/** Read creds → refresh if expired → fetch usage, with two self-repairs on
 * auth failures: re-read the store first (a live claude session has usually
 * rotated the tokens already - refreshing over them could invalidate the
 * chain), then force one refresh. Never throws. */
export async function getClaudeUsage(configDir: string | null, deps: UsageDeps = {}): Promise<UsageSnapshot> {
  const { fetchFn = fetch, usageUrl = USAGE_URL, tokenUrl = TOKEN_URL } = deps;
  const stored = await readCreds(configDir);
  if (!stored) return { fetchedAt: Date.now(), windows: {}, error: "needs login" };

  let { creds, source } = stored;
  if (isExpired(creds)) {
    try {
      creds = await refreshTokens(creds, fetchFn, tokenUrl);
      try {
        await writeCreds(configDir, creds, source);
      } catch {
        // persistence failed, but the rotated token is still valid in memory
      }
    } catch {
      // proceed with the stale token - the request path below self-repairs
      // auth failures, and a live claude session may have rotated the store
    }
  }
  try {
    let attempt = await requestUsage(creds.accessToken, fetchFn, usageUrl);
    if (isAuthFailure(attempt.status)) {
      // repair 1: pick up tokens another process rotated under us
      const reread = await readCreds(configDir);
      if (reread && reread.creds.accessToken !== creds.accessToken) {
        ({ creds, source } = reread);
        attempt = await requestUsage(creds.accessToken, fetchFn, usageUrl);
      }
    }
    if (isAuthFailure(attempt.status)) {
      // repair 2: force one refresh and retry
      let refreshed = false;
      try {
        creds = await refreshTokens(creds, fetchFn, tokenUrl);
        await writeCreds(configDir, creds, source);
        refreshed = true;
      } catch {
        // refresh-token-reuse race: a live claude session rotated the chain
        // mid-flight - repair 3 below picks up what it wrote
      }
      if (!refreshed) {
        const reread = await readCreds(configDir);
        if (!reread) return { fetchedAt: Date.now(), windows: {}, error: "needs login" };
        ({ creds, source } = reread);
      }
      attempt = await requestUsage(creds.accessToken, fetchFn, usageUrl);
    }
    if (attempt.windows) return { fetchedAt: Date.now(), windows: attempt.windows };
    return {
      fetchedAt: Date.now(),
      windows: {},
      error: isAuthFailure(attempt.status) ? "needs login" : "usage unavailable",
    };
  } catch {
    return { fetchedAt: Date.now(), windows: {}, error: "usage unavailable" };
  }
}
