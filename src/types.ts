import type { Thresholds } from "./format";

export type AgentKind = "claude";

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
  error?: "needs login" | "usage unavailable";
}

export type UsageCache = Record<string, UsageSnapshot>;

export interface SkipperConfig {
  defaultLaunchCommand: string;
  sharedItems: string[];
  /** how account emails render in the dashboard and `skipr list` */
  emailDisplay: EmailDisplay;
  /** usage bar/percent turns yellow above warn, red above danger */
  thresholds: Thresholds;
  /** meta overrides for the default profile (it has no profile.json) */
  defaultProfile?: { launchCommand?: string; label?: string };
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
