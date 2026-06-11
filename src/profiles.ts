import {
  existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync,
} from "node:fs";
import { join, sep } from "node:path";
import type { Identity, SkipperConfig, Profile, ProfileMeta } from "./types";
import { claudeJsonPath, profilesDir } from "./paths";
import { loadConfig, saveConfig } from "./config";
import { writeFileAtomic } from "./fsutil";
import { applySync, planSync } from "./symlinks";

const NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

function readMeta(configDir: string): ProfileMeta {
  try {
    return JSON.parse(readFileSync(join(configDir, "profile.json"), "utf8"));
  } catch {
    return { agent: "claude", createdAt: "" };
  }
}

export function listProfiles(config: SkipperConfig): Profile[] {
  const profiles: Profile[] = [
    {
      name: "default",
      configDir: null,
      meta: { agent: "claude", createdAt: "", ...config.defaultProfile },
    },
  ];
  const dir = profilesDir();
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      const configDir = join(dir, name);
      if (!statSync(configDir).isDirectory()) continue;
      profiles.push({ name, configDir, meta: readMeta(configDir) });
    }
  }
  return profiles;
}

export function createProfile(name: string, config: SkipperConfig): Profile {
  if (!NAME_RE.test(name)) throw new Error(`invalid profile name: ${JSON.stringify(name)}`);
  if (name === "default") throw new Error("'default' is reserved for ~/.claude");
  const configDir = join(profilesDir(), name);
  if (existsSync(configDir)) throw new Error(`profile already exists: ${name}`);
  mkdirSync(configDir, { recursive: true });
  const meta: ProfileMeta = { agent: "claude", createdAt: new Date().toISOString() };
  writeFileAtomic(join(configDir, "profile.json"), JSON.stringify(meta, null, 2) + "\n");
  applySync(planSync(configDir, config.sharedItems));
  return { name, configDir, meta };
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
}

export function readIdentity(profile: Profile): Identity {
  try {
    const account = JSON.parse(readFileSync(claudeJsonPath(profile.configDir), "utf8"))?.oauthAccount;
    return {
      email: account?.emailAddress ?? null,
      tier: account?.organizationRateLimitTier ?? null,
    };
  } catch {
    return { email: null, tier: null };
  }
}

export function saveLaunchCommand(profile: Profile, command: string): void {
  if (profile.configDir) {
    const meta = { ...readMeta(profile.configDir), launchCommand: command };
    writeFileAtomic(join(profile.configDir, "profile.json"), JSON.stringify(meta, null, 2) + "\n");
  } else {
    const config = loadConfig();
    config.defaultProfile = { ...config.defaultProfile, launchCommand: command };
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
    config.defaultProfile = { ...config.defaultProfile, label: trimmed || undefined };
    saveConfig(config);
  }
}
