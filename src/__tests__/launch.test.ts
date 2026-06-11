import { describe, expect, test } from "bun:test";
import { splitCommand, resolveLaunchCommand, buildLaunchPlan } from "../launch";
import { DEFAULT_CONFIG } from "../config";
import type { Profile } from "../types";

const named: Profile = {
  name: "work",
  configDir: "/p/profiles/work",
  meta: { agent: "claude", createdAt: "" },
};
const def: Profile = { name: "default", configDir: null, meta: { agent: "claude", createdAt: "" } };

describe("splitCommand", () => {
  test("splits on whitespace", () => {
    expect(splitCommand("claude --dangerously-skip-permissions")).toEqual([
      "claude", "--dangerously-skip-permissions",
    ]);
    expect(splitCommand("  claude  ")).toEqual(["claude"]);
  });
});

describe("resolveLaunchCommand", () => {
  test("profile override beats config default", () => {
    const p = { ...named, meta: { ...named.meta, launchCommand: "claude --fast" } };
    expect(resolveLaunchCommand(p, DEFAULT_CONFIG)).toBe("claude --fast");
    expect(resolveLaunchCommand(named, DEFAULT_CONFIG)).toBe("claude");
  });
});

describe("buildLaunchPlan", () => {
  test("named profile sets CLAUDE_CONFIG_DIR and appends extra args", () => {
    const plan = buildLaunchPlan(named, DEFAULT_CONFIG, ["--resume", "abc"]);
    expect(plan.argv).toEqual(["claude", "--resume", "abc"]);
    expect(plan.env.CLAUDE_CONFIG_DIR).toBe("/p/profiles/work");
  });
  test("default profile gets no CLAUDE_CONFIG_DIR even if parent shell had one", () => {
    process.env.CLAUDE_CONFIG_DIR = "/leaked/from/parent";
    const plan = buildLaunchPlan(def, DEFAULT_CONFIG);
    delete process.env.CLAUDE_CONFIG_DIR;
    expect("CLAUDE_CONFIG_DIR" in plan.env).toBe(false);
    expect(plan.argv).toEqual(["claude"]);
  });
});

describe("codex launch plans", () => {
  const codexNamed: Profile = {
    name: "cx", configDir: "/p/profiles/cx", meta: { agent: "codex", createdAt: "" },
  };
  const codexDefault: Profile = {
    name: "codex", configDir: null, meta: { agent: "codex", createdAt: "" },
  };
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.providers.codex.launchCommand = "codex --full-auto";

  test("codex profiles resolve the codex launch command and set CODEX_HOME", () => {
    const plan = buildLaunchPlan(codexNamed, cfg);
    expect(plan.argv).toEqual(["codex", "--full-auto"]);
    expect(plan.env.CODEX_HOME).toBe("/p/profiles/cx");
    expect("CLAUDE_CONFIG_DIR" in plan.env).toBe(false);
  });

  test("default codex profile clears both home overrides", () => {
    process.env.CODEX_HOME = "/leaked";
    process.env.CLAUDE_CONFIG_DIR = "/leaked2";
    const plan = buildLaunchPlan(codexDefault, cfg);
    delete process.env.CODEX_HOME;
    delete process.env.CLAUDE_CONFIG_DIR;
    expect("CODEX_HOME" in plan.env).toBe(false);
    expect("CLAUDE_CONFIG_DIR" in plan.env).toBe(false);
  });

  test("claude launches never carry CODEX_HOME", () => {
    process.env.CODEX_HOME = "/leaked";
    const plan = buildLaunchPlan(named, DEFAULT_CONFIG);
    delete process.env.CODEX_HOME;
    expect("CODEX_HOME" in plan.env).toBe(false);
    expect(plan.env.CLAUDE_CONFIG_DIR).toBe("/p/profiles/work");
  });
});

describe("auth env scrubbing", () => {
  test("shell auth keys never leak into launched sessions", () => {
    process.env.ANTHROPIC_API_KEY = "sk-leak";
    process.env.OPENAI_API_KEY = "sk-leak2";
    const plan = buildLaunchPlan(named, DEFAULT_CONFIG);
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect("ANTHROPIC_API_KEY" in plan.env).toBe(false);
    expect("OPENAI_API_KEY" in plan.env).toBe(false);
  });
});
