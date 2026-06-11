import { existsSync, readFileSync, renameSync } from "node:fs";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { EmailDisplay, ProfileOverlay, Provider, ProviderConfig, SkipperConfig } from "./types";
import { ADAPTERS } from "./providers/registry";
import { resolveSpec, specsUnder, validateValue } from "./configSchema";
import { DEFAULT_THRESHOLDS, type Thresholds } from "./format";
import { configPath, legacyConfigJsonPath } from "./paths";
import { writeFileAtomic } from "./fsutil";

export const PROVIDERS: Provider[] = ["claude", "codex"];

export const DEFAULT_CONFIG: SkipperConfig = {
  defaultProvider: "claude",
  providers: {
    claude: { launchCommand: "claude", sharedItems: [...ADAPTERS.claude.defaultSharedItems] },
    codex: { launchCommand: "codex", sharedItems: [...ADAPTERS.codex.defaultSharedItems] },
  },
  emailDisplay: "show",
  thresholds: { ...DEFAULT_THRESHOLDS },
};

export function getConfigValue(config: SkipperConfig, path: string): unknown {
  let node: unknown = config;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/** Sets a schema-validated dot-path value in place. Values are JSON-parsed
 * when valid ("true" → boolean, "55" → number, '["a"]' → array), otherwise
 * kept as strings. */
export function setConfigValue(config: SkipperConfig, path: string, raw: string): void {
  const spec = resolveSpec(path);
  if (!spec) {
    const deeper = specsUnder(path);
    if (deeper.length > 0) {
      throw new Error(`'${path}' is a section - set one of: ${deeper.map((d) => d.path).join(", ")}`);
    }
    throw new Error(`unknown config key: ${path} (see 'skipr config keys')`);
  }
  let value: unknown = raw;
  if (spec.type !== "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      // fall through to validation with the raw string
    }
  }
  const problem = validateValue(spec, value);
  if (problem) throw new Error(`${path}: ${problem}`);
  let node = config as unknown as Record<string, unknown>;
  const parts = path.split(".");
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== "object") node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts.at(-1)!] = value;
}

/** Removes an optional dot-path value (reverts to the default). */
export function unsetConfigValue(config: SkipperConfig, path: string): void {
  if (!resolveSpec(path) && specsUnder(path).length === 0) {
    throw new Error(`unknown config key: ${path} (see 'skipr config keys')`);
  }
  const parts = path.split(".");
  let node = config as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== "object") return; // nothing to unset
    node = node[part] as Record<string, unknown>;
  }
  delete node[parts.at(-1)!];
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

/** Per-provider deep merge, including migration from the pre-provider flat
 * keys (defaultLaunchCommand, codexLaunchCommand, defaultProfile,
 * codexProfile) so existing configs keep working untouched. */
function mergeProviders(parsed: Record<string, unknown>): Record<Provider, ProviderConfig> {
  const merged = structuredClone(DEFAULT_CONFIG.providers);
  const rawProviders = (parsed.providers ?? {}) as Record<string, Partial<ProviderConfig>>;
  const legacy: Record<Provider, { command: unknown; profile: unknown }> = {
    claude: { command: parsed.defaultLaunchCommand, profile: parsed.defaultProfile },
    codex: { command: parsed.codexLaunchCommand, profile: parsed.codexProfile },
  };
  for (const provider of PROVIDERS) {
    const raw = rawProviders[provider] ?? {};
    const command = raw.launchCommand ?? legacy[provider].command;
    if (typeof command === "string" && command.trim()) merged[provider].launchCommand = command;
    const profile = raw.defaultProfile ?? legacy[provider].profile;
    if (profile && typeof profile === "object") {
      merged[provider].defaultProfile = { ...(profile as ProviderConfig["defaultProfile"]) };
    }
    // per-provider shared items; the legacy top-level list was claude's
    const shared =
      raw.sharedItems ?? (provider === "claude" ? (parsed.sharedItems as unknown) : undefined);
    if (Array.isArray(shared) && shared.every((v) => typeof v === "string")) {
      merged[provider].sharedItems = [...shared];
    }
    if (typeof (raw as ProviderConfig).defaultProfileName === "string") {
      merged[provider].defaultProfileName = (raw as ProviderConfig).defaultProfileName;
    }
  }
  return merged;
}

function normalizeDefaultProvider(parsed: Record<string, unknown>): Provider {
  return PROVIDERS.includes(parsed.defaultProvider as Provider)
    ? (parsed.defaultProvider as Provider)
    : "claude";
}

const LEGACY_KEYS = [
  "anonymizeEmails",
  "defaultLaunchCommand",
  "codexLaunchCommand",
  "defaultProfile",
  "codexProfile",
  "sharedItems",
];

/** Keep only well-typed overlay fields; junk degrades silently (doctor reports it). */
function mergeProfileOverlays(parsed: Record<string, unknown>): Record<string, ProfileOverlay> | undefined {
  const raw = parsed.profiles;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const overlays: Record<string, ProfileOverlay> = {};
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const overlay: ProfileOverlay = {};
    if (typeof e.label === "string") overlay.label = e.label;
    if (typeof e.launchCommand === "string") overlay.launchCommand = e.launchCommand;
    if (typeof e.hidden === "boolean") overlay.hidden = e.hidden;
    overlays[name] = overlay;
  }
  return Object.keys(overlays).length > 0 ? overlays : undefined;
}

function readRawConfig(): Record<string, unknown> {
  if (existsSync(configPath())) {
    return (parseToml(readFileSync(configPath(), "utf8")) ?? {}) as Record<string, unknown>;
  }
  // one-time migration from the pre-v0.5 JSON config
  const parsed = JSON.parse(readFileSync(legacyConfigJsonPath(), "utf8")) ?? {};
  return parsed as Record<string, unknown>;
}

/** Persist the TOML migration once, keeping the old JSON as a .bak. */
function persistJsonMigration(config: SkipperConfig): void {
  try {
    saveConfig(config);
    renameSync(legacyConfigJsonPath(), `${legacyConfigJsonPath()}.bak`);
  } catch {
    // read-only fs or similar - keep migrating in memory on every load
  }
}

export function loadConfig(): SkipperConfig {
  try {
    const migratingFromJson = !existsSync(configPath()) && existsSync(legacyConfigJsonPath());
    const parsed = readRawConfig();
    const config = {
      ...structuredClone(DEFAULT_CONFIG),
      ...parsed,
      defaultProvider: normalizeDefaultProvider(parsed),
      providers: mergeProviders(parsed),
      profiles: mergeProfileOverlays(parsed),
      thresholds: mergeThresholds(parsed?.thresholds),
      emailDisplay: normalizeEmailDisplay(parsed),
    };
    for (const key of LEGACY_KEYS) delete (config as Record<string, unknown>)[key];
    if (migratingFromJson) persistJsonMigration(config);
    return config;
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(config: SkipperConfig): void {
  // JSON round-trip strips undefined optionals, which TOML cannot represent
  const clean = JSON.parse(JSON.stringify(config));
  if (clean.profiles && Object.keys(clean.profiles).length === 0) delete clean.profiles;
  writeFileAtomic(configPath(), stringifyToml(clean) + "\n");
}
