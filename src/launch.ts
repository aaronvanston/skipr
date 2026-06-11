import type { SkipperConfig, Profile } from "./types";

/** v1: whitespace split, no quoting support (documented in README). */
export function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

export function resolveLaunchCommand(profile: Profile, config: SkipperConfig): string {
  return profile.meta.launchCommand ?? config.defaultLaunchCommand;
}

export interface LaunchPlan {
  argv: string[];
  env: Record<string, string>;
}

export function buildLaunchPlan(
  profile: Profile,
  config: SkipperConfig,
  extraArgs: string[] = [],
): LaunchPlan {
  const argv = [...splitCommand(resolveLaunchCommand(profile, config)), ...extraArgs];
  const env = { ...process.env } as Record<string, string>;
  if (profile.configDir) env.CLAUDE_CONFIG_DIR = profile.configDir;
  else delete env.CLAUDE_CONFIG_DIR;
  return { argv, env };
}

/** Ink never pauses process.stdin on unmount - it assumes the process exits
 * next. skipr keeps running to wait for the child, so without this the
 * parent would race the child for TTY reads and steal keystrokes
 * (regression-checked by driving the TUI under tmux). */
export function releaseStdin(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode?.(false);
    process.stdin.pause();
  }
}

/** Run the plan in this terminal; resolves to the child's exit code. */
export async function execPlan(plan: LaunchPlan): Promise<number> {
  releaseStdin();
  const proc = Bun.spawn(plan.argv, {
    env: plan.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}
