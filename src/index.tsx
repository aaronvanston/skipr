#!/usr/bin/env bun
import React, { useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import type { EmailDisplay, Identity, PendingAction, Profile, UsageCache } from "./types";
import { DEFAULT_CONFIG, getConfigValue, loadConfig, saveConfig, setConfigValue } from "./config";
import {
  createProfile, defaultProfileIndex, defaultProfileName, deleteProfile, isDefaultProfile,
  listProfiles, readIdentity, saveLabel, saveLaunchCommand, setDefaultProfile,
} from "./profiles";
import { getProfileUsage, mergeSnapshot } from "./usage";
import { loadUsageCache, saveUsageCache } from "./usageCache";
import { listSessionsForProject, copySessionTo } from "./providers/claude/sessions";
import { ADAPTERS } from "./providers/registry";
import { buildLaunchPlan, execPlan, releaseStdin, splitCommand } from "./launch";
import { planSync, applySync } from "./symlinks";
import { shellSetupHint, writeShellEnv } from "./shellEnv";
import { WINDOW_LABELS, displayEmail, resetsIn, tierLabel } from "./format";
import { existsSync } from "node:fs";
import { configPath } from "./paths";
import { App } from "./tui/App";
import pkg from "../package.json";

export function formatList(
  profiles: Profile[],
  identities: Record<string, Identity>,
  usage: UsageCache,
  emailDisplay: EmailDisplay = "show",
): string {
  const lines: string[] = [];
  let lastAgent = "";
  for (const profile of profiles) {
    const agent = profile.meta.agent === "codex" ? "Codex" : "Claude";
    if (agent !== lastAgent) {
      if (lines.length > 0) lines.push("");
      lines.push(`${agent} usage`);
      lastAgent = agent;
    }
    const identity = identities[profile.name] ?? { email: null, tier: null };
    const tier = tierLabel(identity.tier);
    const displayName = profile.meta.label ?? profile.name;
    const email = identity.email ? displayEmail(identity.email, emailDisplay) : "(unknown)";
    lines.push(
      email
        ? `- ${email} (${displayName})${tier ? ` [${tier}]` : ""}`
        : `- ${displayName}${tier ? ` [${tier}]` : ""}`,
    );
    const snap = usage[profile.name];
    if (!snap) {
      lines.push("  - usage not fetched");
      continue;
    }
    if (snap.error) {
      lines.push(`  - ${snap.error}`);
      continue;
    }
    for (const { key, label } of WINDOW_LABELS) {
      const window = snap.windows[key];
      if (!window) continue;
      lines.push(
        `  - ${label}: ${window.utilization.toFixed(1)}% (resets in ${resetsIn(window.resetsAt)})${snap.stale ? " [cached]" : ""}`,
      );
    }
  }
  return lines.join("\n");
}

function gatherIdentities(profiles: Profile[]): Record<string, Identity> {
  return Object.fromEntries(profiles.map((p) => [p.name, readIdentity(p)]));
}

async function fetchAllUsage(profiles: Profile[]): Promise<UsageCache> {
  const previous = loadUsageCache();
  const entries = await Promise.all(
    profiles.map(async (p) => [p.name, mergeSnapshot(previous[p.name], await getProfileUsage(p))] as const),
  );
  const cache = Object.fromEntries(entries);
  // deliberate write from read-style commands: keeps the TUI's cached view warm
  saveUsageCache(cache);
  return cache;
}

const SETUP_OPTIONS: Array<{ value: EmailDisplay; title: string }> = [
  { value: "show", title: "Show full email addresses" },
  { value: "hide", title: "Hide them entirely (good for screen-sharing)" },
];

function Setup({ onChoose }: { onChoose: (value: EmailDisplay) => void }) {
  const { exit } = useApp();
  const [idx, setIdx] = useState(0);
  useInput((_ch, key) => {
    if (key.upArrow) setIdx((i) => Math.max(0, i - 1));
    else if (key.downArrow) setIdx((i) => Math.min(SETUP_OPTIONS.length - 1, i + 1));
    else if (key.return) {
      onChoose(SETUP_OPTIONS[idx].value);
      exit();
    }
  });
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Welcome aboard. Let's set up skipr.</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>How should account emails appear in the dashboard and `skipr list`?</Text>
        {SETUP_OPTIONS.map((option, i) => (
          <Text key={option.value} color={i === idx ? "cyan" : undefined} bold={i === idx}>
            {i === idx ? "❯ " : "  "}
            {option.title}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ choose · ⏎ confirm · change later with `c` in the dashboard or `skipr config`</Text>
      </Box>
    </Box>
  );
}

/** First run only (no config file yet): one-question onboarding, then persist
 * the full effective config so `c` (edit config) has a real file to open. */
async function runSetupIfNeeded(): Promise<void> {
  if (existsSync(configPath())) return;
  let choice: EmailDisplay = "show";
  const instance = render(<Setup onChoose={(value) => { choice = value; }} />);
  await instance.waitUntilExit();
  saveConfig({ ...structuredClone(DEFAULT_CONFIG), emailDisplay: choice });
}

function renderOnce(): Promise<PendingAction> {
  return new Promise((resolveAction) => {
    const config = loadConfig();
    const profiles = listProfiles(config);
    let action: PendingAction = { type: "quit" };
    const instance = render(
      <App
        profiles={profiles}
        identities={gatherIdentities(profiles)}
        config={config}
        loadCache={loadUsageCache}
        fetchUsage={getProfileUsage}
        mergeSnapshot={mergeSnapshot}
        saveCache={saveUsageCache}
        createProfile={(name, agent) => createProfile(name, config, agent)}
        deleteProfile={deleteProfile}
        saveLaunchCommand={saveLaunchCommand}
        saveLabel={saveLabel}
        setDefaultProfile={setDefaultProfile}
        isDefaultProfile={(p) => isDefaultProfile(p, config)}
        initialSelection={defaultProfileIndex(profiles, config)}
        listSessions={(all, exclude) => listSessionsForProject(process.cwd(), all, exclude)}
        copySession={(session, target) => copySessionTo(session, target, process.cwd())}
        onDone={(a) => {
          action = a;
        }}
      />,
    );
    instance.waitUntilExit().then(() => resolveAction(action));
  });
}

async function runLogin(profile: Profile): Promise<void> {
  const adapter = ADAPTERS[profile.meta.agent];
  const env = { ...process.env } as Record<string, string>;
  // mirror buildLaunchPlan: never leak home overrides or shell auth keys
  for (const a of Object.values(ADAPTERS)) {
    delete env[a.envVar];
    for (const key of a.scrubEnv) delete env[key];
  }
  if (profile.configDir) env[adapter.envVar] = profile.configDir;
  const argv = [...adapter.loginArgv];
  console.log(`\nLogging in profile '${profile.name}': complete the ${adapter.label} login flow.\n`);
  releaseStdin();
  try {
    const proc = Bun.spawn(argv, { env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    await proc.exited;
  } catch {
    console.error(`failed to launch '${argv[0]}': is it installed and on PATH?`);
  }
}

async function runTui(): Promise<void> {
  await runSetupIfNeeded();
  while (true) {
    const action = await renderOnce();
    if (action.type === "quit") return;
    if (action.type === "reload") continue;
    if (action.type === "config") {
      saveConfig(loadConfig()); // materialize defaults so every key is visible
      releaseStdin();
      const editor = process.env.EDITOR?.trim() || "vi";
      const proc = Bun.spawn([...splitCommand(editor), configPath()], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
      continue;
    }
    if (action.type === "login") {
      await runLogin(action.profile);
      continue;
    }
    if (action.type === "launch") {
      const plan = buildLaunchPlan(action.profile, loadConfig(), action.extraArgs);
      try {
        process.exit(await execPlan(plan));
      } catch {
        console.error(`failed to launch '${plan.argv[0]}': is it installed and on PATH?`);
        process.exit(1);
      }
    }
  }
}

async function cmdList(): Promise<void> {
  const config = loadConfig();
  const profiles = listProfiles(config);
  const usage = await fetchAllUsage(profiles);
  console.log(formatList(profiles, gatherIdentities(profiles), usage, config.emailDisplay));
}

async function cmdLaunch(args: string[]): Promise<void> {
  const dashDash = args.indexOf("--");
  const named = dashDash === 0 ? undefined : args[0];
  const extraArgs = dashDash === -1 ? args.slice(1) : args.slice(dashDash + 1);
  const config = loadConfig();
  const profiles = listProfiles(config);
  // bare `skipr launch` runs the default provider's default profile
  const name = named ?? defaultProfileName(config, config.defaultProvider);
  const profile = profiles.find((p) => p.name === name);
  if (!profile) {
    console.error(
      `unknown profile: ${name}\navailable profiles: ${profiles.map((p) => p.name).join(", ")}`,
    );
    process.exit(1);
  }
  const plan = buildLaunchPlan(profile, config, extraArgs);
  try {
    process.exit(await execPlan(plan));
  } catch {
    console.error(`failed to launch '${plan.argv[0]}': is it installed and on PATH?`);
    process.exit(1);
  }
}

function cmdSync(): void {
  const config = loadConfig();
  for (const profile of listProfiles(config)) {
    if (!profile.configDir || profile.meta.agent === "codex") continue;
    for (const action of applySync(planSync(profile.configDir, config.sharedItems))) {
      console.log(`${profile.name}: ${action.item} → ${action.action}`);
    }
  }
}

export function formatConfigOutput(): string {
  return `${configPath()}\n${JSON.stringify(loadConfig(), null, 2)}`;
}

function cmdConfig(args: string[]): void {
  const [action, path, value] = args;
  if (!action) {
    console.log(formatConfigOutput());
    return;
  }
  if (action === "get" && path) {
    console.log(JSON.stringify(getConfigValue(loadConfig(), path)));
    return;
  }
  if (action === "set" && path && value !== undefined) {
    const config = loadConfig();
    try {
      setConfigValue(config, path, value);
    } catch (err) {
      console.error(String(err instanceof Error ? err.message : err));
      process.exit(1);
    }
    saveConfig(config);
    console.log(`${path} = ${JSON.stringify(getConfigValue(config, path))}`);
    return;
  }
  console.error("usage: skipr config [get <key> | set <key> <value>]");
  process.exit(1);
}

/** `skipr default` - show or set per-provider system defaults. */
function cmdDefault(args: string[]): void {
  const config = loadConfig();
  const profiles = listProfiles(config);
  const [name] = args;
  if (name) {
    const profile = profiles.find((p) => p.name === name);
    if (!profile) {
      console.error(`unknown profile: ${name}\navailable profiles: ${profiles.map((p) => p.name).join(", ")}`);
      process.exit(1);
    }
    setDefaultProfile(profile);
    console.log(`${ADAPTERS[profile.meta.agent].label} default profile is now '${name}'`);
  } else {
    writeShellEnv(config); // keep env.sh in sync with the config
    for (const adapter of Object.values(ADAPTERS)) {
      console.log(`${adapter.label.padEnd(7)} default: ${defaultProfileName(config, adapter.id)}`);
    }
  }
  const hint = shellSetupHint();
  if (hint) console.log(hint);
}

function printVersion(): void {
  console.log(pkg.version);
}

function printHelp(): void {
  console.log(`skipr - multi-account manager for your coding agents (Claude Code today)

usage:
  skipr                            interactive dashboard
  skipr list                       usage summary for all profiles
  skipr launch [name] [-- args]    launch a profile (default profile when no name)
  skipr sync                       repair shared-item symlinks
  skipr default [name]             show or set a provider's default profile
  skipr config                     show config file path and effective config
  skipr config get <key>           read one config value (dot paths ok)
  skipr config set <key> <value>   change a config value (e.g. thresholds.warn 50)
  skipr --version                  print version

profiles are created from the interactive dashboard (press n).`);
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "list") await cmdList();
  else if (command === "launch") await cmdLaunch(rest);
  else if (command === "sync") cmdSync();
  else if (command === "default") cmdDefault(rest);
  else if (command === "config") cmdConfig(rest);
  else if (command === "--version" || command === "-v") printVersion();
  else if (command === "--help" || command === "-h" || command === "help") printHelp();
  else if (command) {
    console.error(`unknown command: ${command}`);
    printHelp();
    process.exit(1);
  } else await runTui();
}
