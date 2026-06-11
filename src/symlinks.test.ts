import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, lstatSync, readlinkSync, readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planSync, applySync } from "./symlinks";

let tmp: string;
let claudeDir: string;
let profileDir: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skipper-test-"));
  process.env.SKIPPER_CLAUDE_HOME = claudeDir = join(tmp, ".claude");
  profileDir = join(tmp, "profiles", "work");
  mkdirSync(join(claudeDir, "skills"), { recursive: true });
  writeFileSync(join(claudeDir, "CLAUDE.md"), "# global\n");
  mkdirSync(profileDir, { recursive: true });
});
afterEach(() => {
  delete process.env.SKIPPER_CLAUDE_HOME;
  rmSync(tmp, { recursive: true, force: true });
});

describe("planSync", () => {
  test("create for missing links, missing-target for absent claude items", () => {
    const plan = planSync(profileDir, ["skills", "CLAUDE.md", "agents"]);
    expect(plan.map((a) => [a.item, a.action])).toEqual([
      ["skills", "create"],
      ["CLAUDE.md", "create"],
      ["agents", "missing-target"],
    ]);
  });

  test("ok for correct links, create for wrong links, conflict for real files", () => {
    symlinkSync(join(claudeDir, "skills"), join(profileDir, "skills"));
    symlinkSync("/somewhere/else", join(profileDir, "CLAUDE.md"));
    mkdirSync(join(claudeDir, "agents"));
    writeFileSync(join(profileDir, "agents"), "i am a real file");
    const plan = planSync(profileDir, ["skills", "CLAUDE.md", "agents"]);
    expect(plan.map((a) => a.action)).toEqual(["ok", "create", "conflict"]);
  });
});

describe("planSync invalid names", () => {
  test("path-like sharedItems entries are rejected, never symlinked", () => {
    const plan = planSync(profileDir, ["../escape", "a/b", "skills"]);
    expect(plan.map((a) => a.action)).toEqual(["invalid-name", "invalid-name", "create"]);
    applySync(plan);
    expect(lstatSync(join(profileDir, "skills")).isSymbolicLink()).toBe(true);
  });
});

describe("applySync", () => {
  test("creates links, fixes wrong links, never touches conflicts", () => {
    symlinkSync("/somewhere/else", join(profileDir, "CLAUDE.md"));
    mkdirSync(join(claudeDir, "agents"));
    writeFileSync(join(profileDir, "agents"), "real");
    applySync(planSync(profileDir, ["skills", "CLAUDE.md", "agents"]));

    expect(readlinkSync(join(profileDir, "skills"))).toBe(join(claudeDir, "skills"));
    expect(readlinkSync(join(profileDir, "CLAUDE.md"))).toBe(join(claudeDir, "CLAUDE.md"));
    expect(lstatSync(join(profileDir, "agents")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(profileDir, "agents"), "utf8")).toBe("real");
  });
});
