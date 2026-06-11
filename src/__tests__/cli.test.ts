import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatList, formatConfigOutput } from "../index";
import { parse as parseToml } from "smol-toml";
import { DEFAULT_CONFIG } from "../config";
import { configPath } from "../paths";
import type { Profile, UsageCache, Identity } from "../types";

describe("formatList", () => {
  test("renders the issue-30031-style text dump", () => {
    const profiles: Profile[] = [
      { name: "default", configDir: null, meta: { agent: "claude", createdAt: "" } },
      { name: "work", configDir: "/p/w", meta: { agent: "claude", createdAt: "" } },
    ];
    const identities: Record<string, Identity> = {
      default: { email: "personal@example.com", tier: "default_claude_max_5x" },
      work: { email: "work@example.com", tier: "default_claude_max_20x" },
    };
    const usage: UsageCache = {
      default: {
        fetchedAt: 0,
        windows: {
          // +30s cushion so the ms elapsed before resetsIn floors can't tip the minute
          five_hour: { utilization: 92, resetsAt: new Date(Date.now() + 4 * 3600_000 + 53 * 60_000 + 30_000).toISOString() },
          seven_day: { utilization: 71, resetsAt: new Date(Date.now() + 53 * 3600_000 + 30_000).toISOString() },
        },
      },
      work: { fetchedAt: 0, windows: {}, error: "needs login" },
    };
    const out = formatList(profiles, identities, usage);
    expect(out).toContain("Claude usage");
    expect(out).toContain("- personal@example.com (default) [Max 5x]");
    expect(out).toContain("  - 5-hour: 92.0% (resets in 4h 53m)");
    expect(out).toContain("  - 7-day: 71.0% (resets in 2d 5h)");
    expect(out).toContain("- work@example.com (work) [Max 20x]");
    expect(out).toContain("needs login");
  });
});

describe("skipr launch errors", () => {
  const entry = join(import.meta.dir, "..", "index.tsx");

  function runLaunch(args: string[]) {
    const tmp = mkdtempSync(join(tmpdir(), "skipper-launch-test-"));
    try {
      const skipperHome = join(tmp, ".skipper");
      mkdirSync(skipperHome, { recursive: true });
      // harmless launch command so bare launches don't start a real agent
      writeFileSync(
        join(skipperHome, "config.json"),
        JSON.stringify({ providers: { claude: { launchCommand: "true" } } }),
      );
      const proc = Bun.spawnSync(["bun", entry, "launch", ...args], {
        env: {
          ...process.env,
          SKIPPER_HOME: skipperHome,
          SKIPPER_CLAUDE_HOME: join(tmp, ".claude"),
          SKIPPER_CODEX_HOME: join(tmp, ".codex"),
        },
      });
      return { exitCode: proc.exitCode, stderr: proc.stderr.toString() };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  test("bare launch runs the default provider's default profile", () => {
    const { exitCode, stderr } = runLaunch([]);
    expect(stderr).not.toContain("unknown profile");
    expect(exitCode).toBe(0); // resolved to the adopted claude default, ran `true`
  });

  test("bare -- with no name launches the default with extra args", () => {
    const { exitCode } = runLaunch(["--", "--resume"]);
    expect(exitCode).toBe(0);
  });

  test("unknown profile lists available profiles", () => {
    const { exitCode, stderr } = runLaunch(["nope"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("unknown profile: nope");
    expect(stderr).toContain("available profiles: default");
  });
});

describe("formatConfigOutput", () => {
  test("prints config path on the first line, then pretty effective config JSON", () => {
    const tmp = mkdtempSync(join(tmpdir(), "skipper-cli-test-"));
    process.env.SKIPPER_HOME = join(tmp, ".skipper");
    try {
      const out = formatConfigOutput();
      const [first, ...rest] = out.split("\n");
      expect(first).toBe(configPath());
      expect(first).toBe(join(tmp, ".skipper", "config.toml"));
      // no config file exists -> effective config is the defaults, as TOML
      const parsed = parseToml(rest.join("\n")) as { thresholds: { warn: number; danger: number } };
      expect(parsed.thresholds).toEqual({ warn: 60, danger: 85 });
      expect(parsed).toEqual(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
    } finally {
      delete process.env.SKIPPER_HOME;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("formatList emailDisplay + labels", () => {
  test("prefers profile labels and shows full emails in show mode", () => {
    const profiles: Profile[] = [
      { name: "default", configDir: null, meta: { agent: "claude", createdAt: "", label: "Main" } },
    ];
    const out = formatList(
      profiles,
      { default: { email: "alice@example.com", tier: "default_claude_max_20x" } },
      {},
      "show",
    );
    expect(out).toContain("- alice@example.com (Main) [Max 20x]");
  });

  test("hide drops emails, keeping name and tier", () => {
    const profiles: Profile[] = [
      { name: "default", configDir: null, meta: { agent: "claude", createdAt: "" } },
    ];
    const out = formatList(
      profiles,
      { default: { email: "alice@example.com", tier: "default_claude_max_20x" } },
      {},
      "hide",
    );
    expect(out).toContain("- default [Max 20x]");
    expect(out).not.toContain("alice");
  });
});

describe("skipr config set/get", () => {
  const entry = join(import.meta.dir, "..", "index.tsx");

  test("set round-trips through get; unknown keys rejected", () => {
    const tmp = mkdtempSync(join(tmpdir(), "skipper-cfg-test-"));
    const env = { ...process.env, SKIPPER_HOME: join(tmp, ".skipper") };
    try {
      let p = Bun.spawnSync(["bun", entry, "config", "set", "thresholds.warn", "55"], { env });
      expect(p.exitCode).toBe(0);
      expect(p.stdout.toString()).toContain("thresholds.warn = 55");
      p = Bun.spawnSync(["bun", entry, "config", "get", "thresholds.warn"], { env });
      expect(p.stdout.toString().trim()).toBe("55");
      p = Bun.spawnSync(["bun", entry, "config", "get", "thresholds.danger"], { env });
      expect(p.stdout.toString().trim()).toBe("85"); // untouched default survives
      p = Bun.spawnSync(["bun", entry, "config", "set", "typo", "1"], { env });
      expect(p.exitCode).toBe(1);
      expect(p.stderr.toString()).toContain("unknown config key");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
