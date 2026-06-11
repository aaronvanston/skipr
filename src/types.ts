import type { Thresholds } from "./format";

export type Provider = "claude" | "codex";
/** legacy alias; profile.json files store this under the "agent" key */
export type AgentKind = Provider;

export type EmailDisplay = "show" | "hide";

export interface ProfileMeta {
  agent: AgentKind;
  createdAt: string;
  label?: string;
  launchCommand?: string;
}

export interface Profile {
  /** "default" for the adopted ~/.claude, else the dir name under profiles/ */
  name: string;
  /** null for the default profile (no CLAUDE_CONFIG_DIR set on launch) */
  configDir: string | null;
  meta: ProfileMeta;
}

export interface OauthCreds {
  accessToken: string;
  refreshToken: string;
  /** ms epoch */
  expiresAt: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

export interface Identity {
  email: string | null;
  /** raw organizationRateLimitTier, e.g. "default_claude_max_20x" */
  tier: string | null;
}

export interface UsageWindow {
  utilization: number;
  resetsAt: string;
}

export interface UsageSnapshot {
  fetchedAt: number;
  windows: Record<string, UsageWindow>;
  /** display text; the exact value "needs login" also routes ⏎ to the login flow */
  error?: string;
  /** the fetch failed and these are the last good numbers, kept on purpose */
  stale?: boolean;
}

export type UsageCache = Record<string, UsageSnapshot>;

export interface ProviderConfig {
  /** launch command for this provider's profiles with no per-profile override */
  launchCommand: string;
  /** items symlinked from the provider's adopted home into its profiles */
  sharedItems: string[];
  /** which profile is this provider's default (dashboard preselect, bare
   * `skipr launch`); falls back to the adopted home profile */
  defaultProfileName?: string;
  /** overrides for the provider's adopted default profile (it has no profile.json) */
  defaultProfile?: { launchCommand?: string; label?: string };
}

/** config-file overlay for a named profile; wins over its profile.json */
export interface ProfileOverlay {
  label?: string;
  launchCommand?: string;
  /** hide from the dashboard and list without touching the profile dir */
  hidden?: boolean;
}

export interface SkipperConfig {
  /** provider listed first in the dashboard */
  defaultProvider: Provider;
  providers: Record<Provider, ProviderConfig>;
  /** overlays keyed by profile name */
  profiles?: Record<string, ProfileOverlay>;
  /** how account emails render in the dashboard and `skipr list` */
  emailDisplay: EmailDisplay;
  /** usage bar/percent turns yellow above warn, red above danger */
  thresholds: Thresholds;
}

export interface SessionInfo {
  id: string;
  profileName: string;
  path: string;
  mtimeMs: number;
  snippet: string;
}

export type PendingAction =
  | { type: "launch"; profile: Profile; extraArgs: string[] }
  | { type: "login"; profile: Profile }
  | { type: "config" }
  | { type: "reload" }
  | { type: "quit" };
