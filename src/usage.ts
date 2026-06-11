import type { Profile, UsageSnapshot, UsageWindow } from "./types";
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

export async function fetchUsage(
  accessToken: string,
  fetchFn: typeof fetch = fetch,
  usageUrl: string = USAGE_URL,
): Promise<Record<string, UsageWindow>> {
  const res = await fetchFn(usageUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Anthropic-Beta": BETA_HEADER,
      Accept: "application/json",
      "User-Agent": CLAUDE_UA,
    },
  });
  if (!res.ok) throw new Error(`usage fetch failed: HTTP ${res.status}`);
  return parseUsage(await res.json());
}

export interface UsageDeps {
  fetchFn?: typeof fetch;
  usageUrl?: string;
  tokenUrl?: string;
}

/** Read creds → refresh if expired (persisting rotated tokens) → fetch usage.
 * Never throws; failures are encoded in the snapshot's error field. */
export async function getProfileUsage(profile: Profile, deps: UsageDeps = {}): Promise<UsageSnapshot> {
  const { fetchFn = fetch, usageUrl = USAGE_URL, tokenUrl = TOKEN_URL } = deps;
  const stored = await readCreds(profile.configDir);
  if (!stored) return { fetchedAt: Date.now(), windows: {}, error: "needs login" };

  let { creds } = stored;
  if (isExpired(creds)) {
    try {
      creds = await refreshTokens(creds, fetchFn, tokenUrl);
    } catch {
      return { fetchedAt: Date.now(), windows: {}, error: "needs login" };
    }
    try {
      await writeCreds(profile.configDir, creds, stored.source);
    } catch {
      // persistence failed, but the rotated token is still valid in memory -
      // don't report "needs login" for a disk problem
    }
  }
  try {
    return { fetchedAt: Date.now(), windows: await fetchUsage(creds.accessToken, fetchFn, usageUrl) };
  } catch {
    return { fetchedAt: Date.now(), windows: {}, error: "usage unavailable" };
  }
}
