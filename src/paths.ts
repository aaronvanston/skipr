import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function skipperHome(): string {
  return process.env.SKIPPER_HOME ?? join(homedir(), ".skipper");
}

export function claudeHome(): string {
  return process.env.SKIPPER_CLAUDE_HOME ?? join(homedir(), ".claude");
}

export function profilesDir(): string {
  return join(skipperHome(), "profiles");
}

export function configPath(): string {
  return join(skipperHome(), "config.json");
}

export function usageCachePath(): string {
  return join(skipperHome(), "cache", "usage.json");
}

/** Claude Code keeps .claude.json inside CLAUDE_CONFIG_DIR; for the default
 * setup it lives beside ~/.claude (i.e. ~/.claude.json). */
export function claudeJsonPath(configDir: string | null): string {
  return configDir ? join(configDir, ".claude.json") : join(dirname(claudeHome()), ".claude.json");
}

export function credentialsPath(configDir: string | null): string {
  return join(configDir ?? claudeHome(), ".credentials.json");
}
