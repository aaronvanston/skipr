import {
  existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync,
} from "node:fs";
import { join, sep } from "node:path";
import type { AgentKind, Identity, Provider, SkipperConfig, Profile, ProfileMeta } from "./types";
import { profilesDir } from "./paths";
import { loadConfig, saveConfig } from "./config";
import { writeFileAtomic } from "./fsutil";
import { applySync, planSync } from "./symlinks";
import { ADAPTERS, RESERVED_NAMES } from "./providers/registry";

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function readMeta(configDir: string): ProfileMeta {
  try {
    return JSON.parse(readFileSync(join(configDir, "profile.json"), "utf8"));
  } catch {
    return { agent: "claude", createdAt: "" };
  }
}

/** Ordered for display: per provider (defaultProvider first), the adopted
 * default profile then that provider's named profiles. The codex default
 * only appears when ~/.codex exists. */
export function listProfiles(config: SkipperConfig, opts: { includeHidden?: boolean } = {}): Profile[] {
  const named: Profile[] = [];
  const dir = profilesDir();
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      const configDir = join(dir, name);
      if (!statSync(configDir).isDirectory()) continue;
      named.push({ name, configDir, meta: readMeta(configDir) });
    }
  }
  const order: Provider[] = [
    config.defaultProvider,
    ...(Object.keys(ADAPTERS) as Provider[]).filter((p) => p !== config.defaultProvider),
  ];
  const profiles: Profile[] = [];
  for (const provider of order) {
    const adapter = ADAPTERS[provider];
    const defaults = config.providers[provider].defaultProfile;
    if (adapter.hasAdoptedHome()) {
      profiles.push({
        name: adapter.adoptedName,
        configDir: null,
        meta: { agent: provider, createdAt: "", ...defaults },
      });
    }
    profiles.push(...named.filter((p) => p.meta.agent === provider));
  }
  // config overlays win over profile.json; hidden profiles drop out entirely
  return profiles
    .map((profile) => {
      const overlay = config.profiles?.[profile.name];
      if (!overlay) return profile;
      return { ...profile, meta: { ...profile.meta, ...overlay } };
    })
    .filter((profile) => opts.includeHidden || !(config.profiles?.[profile.name]?.hidden ?? false));
}

export function createProfile(name: string, config: SkipperConfig, agent: AgentKind = "claude"): Profile {
  if (!NAME_RE.test(name)) throw new Error(`invalid profile name: ${JSON.stringify(name)}`);
  if (RESERVED_NAMES.has(name)) throw new Error(`'${name}' is reserved for a provider's default profile`);
  const configDir = join(profilesDir(), name);
  if (existsSync(configDir)) throw new Error(`profile already exists: ${name}`);
  mkdirSync(configDir, { recursive: true });
  const meta: ProfileMeta = { agent, createdAt: new Date().toISOString() };
  writeFileAtomic(join(configDir, "profile.json"), JSON.stringify(meta, null, 2) + "\n");
  const shared = config.providers[agent].sharedItems;
  if (shared.length > 0) applySync(planSync(configDir, shared));
  return { name, configDir, meta };
}

/** The provider's default profile name, falling back to its adopted home. */
export function defaultProfileName(config: SkipperConfig, provider: Provider): string {
  return config.providers[provider].defaultProfileName ?? ADAPTERS[provider].adoptedName;
}

export function isDefaultProfile(profile: Profile, config: SkipperConfig): boolean {
  return defaultProfileName(config, profile.meta.agent) === profile.name;
}

/** Choosing the adopted home clears the override instead of recording it.
 * Also refreshes ~/.skipper/env.sh so sourced shells pick up the change. */
export function setDefaultProfile(profile: Profile): void {
  const config = loadConfig();
  const provider = config.providers[profile.meta.agent];
  provider.defaultProfileName =
    profile.name === ADAPTERS[profile.meta.agent].adoptedName ? undefined : profile.name;
  saveConfig(config);
  // lazy import avoids a module cycle (shellEnv -> profiles)
  const { writeShellEnv } = require("./shellEnv") as typeof import("./shellEnv");
  writeShellEnv(config);
}

/** Where the dashboard selection starts: the default provider's default
 * profile, falling back to the first row. */
export function defaultProfileIndex(profiles: Profile[], config: SkipperConfig): number {
  const wanted = defaultProfileName(config, config.defaultProvider);
  const index = profiles.findIndex(
    (p) => p.meta.agent === config.defaultProvider && p.name === wanted,
  );
  return index === -1 ? 0 : index;
}

export function deleteProfile(profile: Profile): void {
  if (!profile.configDir) throw new Error("the default profile cannot be deleted");
  // realpath (not lexical resolve) so a symlinked profiles dir or config dir
  // can't make a recursive rm escape physical containment
  const base = realpathSync(profilesDir());
  const resolved = realpathSync(profile.configDir);
  if (!resolved.startsWith(base + sep)) {
    throw new Error(`refusing to delete outside profiles dir: ${resolved}`);
  }
  rmSync(resolved, { recursive: true, force: true });
  // a deleted profile must not linger as anyone's default
  const config = loadConfig();
  let changed = false;
  for (const provider of Object.values(config.providers)) {
    if (provider.defaultProfileName === profile.name) {
      provider.defaultProfileName = undefined;
      changed = true;
    }
  }
  if (changed) {
    saveConfig(config);
    const { writeShellEnv } = require("./shellEnv") as typeof import("./shellEnv");
    writeShellEnv(config);
  }
}

export function readIdentity(profile: Profile): Identity {
  return ADAPTERS[profile.meta.agent].identity(profile.configDir);
}

export function saveLaunchCommand(profile: Profile, command: string): void {
  if (profile.configDir) {
    const meta = { ...readMeta(profile.configDir), launchCommand: command };
    writeFileAtomic(join(profile.configDir, "profile.json"), JSON.stringify(meta, null, 2) + "\n");
  } else {
    const config = loadConfig();
    const provider = config.providers[profile.meta.agent];
    provider.defaultProfile = { ...provider.defaultProfile, launchCommand: command };
    saveConfig(config);
  }
}

/** Display label only - the profile dir (and thus its keychain identity)
 * never changes. An empty label clears the override. */
export function saveLabel(profile: Profile, label: string): void {
  const trimmed = label.trim();
  if (profile.configDir) {
    const meta = { ...readMeta(profile.configDir) };
    if (trimmed) meta.label = trimmed;
    else delete meta.label;
    writeFileAtomic(join(profile.configDir, "profile.json"), JSON.stringify(meta, null, 2) + "\n");
  } else {
    const config = loadConfig();
    const provider = config.providers[profile.meta.agent];
    provider.defaultProfile = { ...provider.defaultProfile, label: trimmed || undefined };
    saveConfig(config);
  }
}
