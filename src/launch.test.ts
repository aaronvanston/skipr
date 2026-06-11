import { describe, expect, test } from "bun:test";
import { splitCommand, resolveLaunchCommand, buildLaunchPlan } from "./launch";
import { DEFAULT_CONFIG } from "./config";
import type { Profile } from "./types";

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
