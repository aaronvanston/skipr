import { existsSync, readFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";
import type { SkipperConfig } from "./types";
import { ADAPTERS } from "./providers/registry";
import { collectConfigIssues } from "./configSchema";
import { defaultProfileName, listProfiles, readIdentity } from "./profiles";
import { planSync } from "./symlinks";
import { configPath, legacyConfigJsonPath, shellEnvPath, skipperHome } from "./paths";
import { shellRcHooked } from "./shellEnv";

const OK = "  ✓ ";
const WARN = "  ⚠ ";

function binaryLines(): string[] {
  const lines = ["binaries"];
  for (const adapter of Object.values(ADAPTERS)) {
    const bin = adapter.loginArgv[0];
    const found = Bun.which(bin);
    lines.push(found ? `${OK}${bin} (${found})` : `${WARN}${bin} not found on PATH`);
  }
  return lines;
}

function configLines(): string[] {
  const lines = [`config (${configPath()})`];
  if (!existsSync(configPath())) {
    lines.push(`${WARN}no config file yet (defaults apply; run skipr once to create it)`);
    return lines;
  }
  try {
    const raw = parseToml(readFileSync(configPath(), "utf8"));
    const issues = collectConfigIssues(raw);
    if (issues.length === 0) lines.push(`${OK}valid (no unknown keys)`);
    for (const issue of issues) lines.push(`${WARN}${issue}`);
  } catch (err) {
    lines.push(`${WARN}does not parse: ${err instanceof Error ? err.message : err}`);
  }
  if (existsSync(`${legacyConfigJsonPath()}.bak`)) {
    lines.push(`${OK}legacy config.json migrated (backup at config.json.bak)`);
  }
  return lines;
}

function profileLines(config: SkipperConfig): string[] {
  const lines = ["profiles"];
  const all = listProfiles(config, { includeHidden: true });
  for (const profile of all) {
    const hidden = config.profiles?.[profile.name]?.hidden ?? false;
    const identity = readIdentity(profile);
    const auth = identity.email ? identity.email : "needs login";
    const marks: string[] = [];
    if (hidden) marks.push("hidden");
    if (profile.name === defaultProfileName(config, profile.meta.agent)) marks.push("default");
    const suffix = marks.length > 0 ? ` [${marks.join(", ")}]` : "";
    lines.push(`${identity.email ? OK : WARN}${profile.meta.agent}/${profile.name}: ${auth}${suffix}`);
    if (hidden && profile.configDir) {
      lines.push(`${WARN}  hidden but its data remains at ${profile.configDir} - delete the dir if it is no longer needed`);
    }
    if (profile.configDir) {
      const shared = config.providers[profile.meta.agent].sharedItems;
      for (const action of planSync(profile.configDir, shared)) {
        if (action.action === "conflict") lines.push(`${WARN}  ${action.item}: real file blocks the shared symlink`);
        if (action.action === "invalid-name") lines.push(`${WARN}  ${action.item}: invalid shared item name`);
        if (action.action === "create") lines.push(`${WARN}  ${action.item}: shared symlink missing (run skipr sync)`);
      }
    }
  }
  // overlays pointing at nothing
  const names = new Set(all.map((p) => p.name));
  for (const name of Object.keys(config.profiles ?? {})) {
    if (!names.has(name)) {
      lines.push(`${WARN}config [profiles.${name}] references a profile that no longer exists - remove with: skipr config unset profiles.${name}`);
    }
  }
  // defaults pointing at missing/hidden profiles
  for (const adapter of Object.values(ADAPTERS)) {
    const wanted = config.providers[adapter.id].defaultProfileName;
    if (!wanted) continue;
    const target = all.find((p) => p.meta.agent === adapter.id && p.name === wanted);
    if (!target) lines.push(`${WARN}${adapter.label} default '${wanted}' does not exist - fix with: skipr default <name>`);
    else if (config.profiles?.[wanted]?.hidden) lines.push(`${WARN}${adapter.label} default '${wanted}' is hidden`);
  }
  return lines;
}

function shellLines(): string[] {
  const lines = ["system default (env.sh)"];
  if (!existsSync(shellEnvPath())) {
    lines.push(`${OK}not written yet (defaults are the adopted homes)`);
    return lines;
  }
  lines.push(`${OK}${shellEnvPath()}`);
  lines.push(
    shellRcHooked()
      ? `${OK}sourced from your shell rc`
      : `${WARN}not sourced - add to your shell rc:  source ~/.skipper/env.sh`,
  );
  return lines;
}

export function doctorReport(config: SkipperConfig): string {
  const sections = [
    [`skipr doctor (${skipperHome()})`],
    binaryLines(),
    configLines(),
    profileLines(config),
    shellLines(),
  ];
  return sections.map((s) => s.join("\n")).join("\n\n");
}
