import { readFileSync } from "node:fs";
import type { Identity } from "../../types";
import { claudeJsonPath } from "../../paths";

/** Email and plan tier live in .claude.json's oauthAccount. */
export function readClaudeIdentity(configDir: string | null): Identity {
  try {
    const account = JSON.parse(readFileSync(claudeJsonPath(configDir), "utf8"))?.oauthAccount;
    return {
      email: account?.emailAddress ?? null,
      tier: account?.organizationRateLimitTier ?? null,
    };
  } catch {
    return { email: null, tier: null };
  }
}
