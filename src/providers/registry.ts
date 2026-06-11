import { existsSync } from "node:fs";
import type { Identity, Provider, UsageSnapshot } from "../types";
import { codexHome } from "../paths";
import { readClaudeIdentity } from "./claude/identity";
import { getClaudeUsage, type UsageDeps } from "./claude/usage";
import { codexUsageSmart, readCodexIdentity } from "./codex";

/** Everything skipr needs to know about a provider lives here - adding a
 * provider means adding one adapter, not hunting branches. */
export interface ProviderAdapter {
  id: Provider;
  /** section header / picker label */
  label: string;
  /** env var that relocates the provider's home for a profile */
  envVar: string;
  /** argv that starts the provider's login flow */
  loginArgv: string[];
  /** dashboard name of the adopted default profile (the real home dir) */
  adoptedName: string;
  /** whether the adopted home exists on this machine */
  hasAdoptedHome(): boolean;
  identity(configDir: string | null): Identity;
  usage(configDir: string | null, deps?: UsageDeps): Promise<UsageSnapshot>;
  /** auth env vars that would override the profile's identity if leaked */
  scrubEnv: string[];
  /** session transcripts can hop between this provider's profiles */
  supportsSessionHop: boolean;
  /** symlink config.sharedItems into new profiles */
  sharesItems: boolean;
}

export const ADAPTERS: Record<Provider, ProviderAdapter> = {
  claude: {
    id: "claude",
    label: "Claude",
    envVar: "CLAUDE_CONFIG_DIR",
    loginArgv: ["claude", "/login"],
    adoptedName: "default",
    hasAdoptedHome: () => true,
    identity: readClaudeIdentity,
    usage: getClaudeUsage,
    scrubEnv: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
    supportsSessionHop: true,
    sharesItems: true,
  },
  codex: {
    id: "codex",
    label: "Codex",
    envVar: "CODEX_HOME",
    loginArgv: ["codex", "login"],
    adoptedName: "codex",
    hasAdoptedHome: () => existsSync(codexHome()),
    identity: readCodexIdentity,
    usage: (configDir) => codexUsageSmart(configDir),
    scrubEnv: ["OPENAI_API_KEY"],
    supportsSessionHop: false,
    sharesItems: false,
  },
};

export const PROVIDER_IDS = Object.keys(ADAPTERS) as Provider[];

/** names reserved for adopted default profiles */
export const RESERVED_NAMES = new Set(Object.values(ADAPTERS).map((a) => a.adoptedName));
