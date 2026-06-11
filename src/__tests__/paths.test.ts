import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  skipperHome, claudeHome, claudeJsonPath, profilesDir,
  configPath, usageCachePath, credentialsPath,
} from "../paths";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skipper-test-"));
  process.env.SKIPPER_HOME = join(tmp, ".skipper");
  process.env.SKIPPER_CLAUDE_HOME = join(tmp, ".claude");
});
afterEach(() => {
  delete process.env.SKIPPER_HOME;
  delete process.env.SKIPPER_CLAUDE_HOME;
  rmSync(tmp, { recursive: true, force: true });
});

describe("paths", () => {
  test("env overrides are respected", () => {
    expect(skipperHome()).toBe(join(tmp, ".skipper"));
    expect(claudeHome()).toBe(join(tmp, ".claude"));
    expect(profilesDir()).toBe(join(tmp, ".skipper", "profiles"));
    expect(configPath()).toBe(join(tmp, ".skipper", "config.toml"));
    expect(usageCachePath()).toBe(join(tmp, ".skipper", "cache", "usage.json"));
  });

  test(".claude.json lives inside profile dirs, beside claudeHome for default", () => {
    expect(claudeJsonPath("/x/profiles/work")).toBe("/x/profiles/work/.claude.json");
    expect(claudeJsonPath(null)).toBe(join(tmp, ".claude.json"));
  });

  test("credentials path is inside the config dir (claudeHome for default)", () => {
    expect(credentialsPath("/x/profiles/work")).toBe("/x/profiles/work/.credentials.json");
    expect(credentialsPath(null)).toBe(join(tmp, ".claude", ".credentials.json"));
  });
});
