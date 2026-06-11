import type { Profile, UsageSnapshot } from "./types";
import { ADAPTERS } from "./providers/registry";
import type { UsageDeps } from "./providers/claude/usage";

export type { UsageDeps } from "./providers/claude/usage";
export { USAGE_URL, fetchUsage, parseUsage } from "./providers/claude/usage";

/** Self-repair at the cache layer: a failed fetch never erases the last good
 * numbers - they stay on screen marked stale. "needs login" is actionable and
 * always surfaces. */
export function mergeSnapshot(
  previous: UsageSnapshot | undefined,
  next: UsageSnapshot,
): UsageSnapshot {
  const previousHasData = previous && Object.keys(previous.windows).length > 0;
  if (next.error && next.error !== "needs login" && previousHasData) {
    return { ...previous, stale: true };
  }
  return next;
}

/** Routes to the profile's provider; never throws. */
export async function getProfileUsage(profile: Profile, deps: UsageDeps = {}): Promise<UsageSnapshot> {
  return ADAPTERS[profile.meta.agent].usage(profile.configDir, deps);
}
