import { readFileSync } from "node:fs";
import type { EmailDisplay, SkipperConfig } from "./types";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./format";
import { configPath } from "./paths";
import { writeFileAtomic } from "./fsutil";

export const DEFAULT_CONFIG: SkipperConfig = {
  defaultLaunchCommand: "claude",
  sharedItems: ["skills", "agents", "commands", "plugins", "CLAUDE.md"],
  thresholds: { ...DEFAULT_THRESHOLDS },
  emailDisplay: "show",
};

/** Top-level keys `skipr config set` may touch - typo guard. */
const KNOWN_KEYS = new Set([...Object.keys(DEFAULT_CONFIG), "defaultProfile"]);

export function getConfigValue(config: SkipperConfig, path: string): unknown {
  let node: unknown = config;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Sets a dot-path value in place. Values are JSON-parsed when valid
 * ("true" → boolean, "55" → number), otherwise kept as strings. */
export function setConfigValue(config: SkipperConfig, path: string, raw: string): void {
  const parts = path.split(".");
  if (!KNOWN_KEYS.has(parts[0])) {
    throw new Error(`unknown config key: ${parts[0]} (known: ${[...KNOWN_KEYS].join(", ")})`);
  }
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    // not JSON - keep the raw string
  }
  let node = config as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== "object") node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts.at(-1)!] = value;
}

// per-key fallback for the nested thresholds object: a partial override like
// {"thresholds": {"warn": 50}} keeps the default danger instead of dropping it.
// Non-numeric values are ignored so barColor never compares against undefined/NaN.
function mergeThresholds(raw: unknown): Thresholds {
  const merged = { ...DEFAULT_THRESHOLDS };
  if (raw && typeof raw === "object") {
    for (const key of ["warn", "danger"] as const) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === "number" && Number.isFinite(value)) merged[key] = value;
    }
  }
  return merged;
}

function normalizeEmailDisplay(parsed: Record<string, unknown>): EmailDisplay {
  const explicit = parsed.emailDisplay;
  if (explicit === "show" || explicit === "hide") return explicit;
  // legacy values: the v0.2 "mask" mode and the anonymizeEmails boolean both
  // collapse to full removal - partial masks still leaked the email's shape
  if (explicit === "mask" || parsed.anonymizeEmails === true) return "hide";
  return "show";
}

export function loadConfig(): SkipperConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), "utf8"));
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      ...parsed,
      thresholds: mergeThresholds(parsed?.thresholds),
      emailDisplay: normalizeEmailDisplay(parsed ?? {}),
    };
    delete (config as Record<string, unknown>).anonymizeEmails;
    return config;
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(config: SkipperConfig): void {
  writeFileAtomic(configPath(), JSON.stringify(config, null, 2) + "\n");
}
