import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorReport } from "../doctor";
import { DEFAULT_CONFIG } from "../config";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skipper-test-"));
  process.env.SKIPPER_HOME = join(tmp, ".skipper");
  process.env.SKIPPER_CLAUDE_HOME = join(tmp, ".claude");
  process.env.SKIPPER_CODEX_HOME = join(tmp, ".codex");
  mkdirSync(join(tmp, ".skipper"), { recursive: true });
  mkdirSync(join(tmp, ".claude"), { recursive: true });
});
afterEach(() => {
  for (const key of ["SKIPPER_HOME", "SKIPPER_CLAUDE_HOME", "SKIPPER_CODEX_HOME"]) delete process.env[key];
  rmSync(tmp, { recursive: true, force: true });
});

describe("doctorReport", () => {
  test("flags orphaned overlays, hidden data dirs, and missing defaults", () => {
    mkdirSync(join(tmp, ".skipper", "profiles", "ghosted"), { recursive: true });
    writeFileSync(
      join(tmp, ".skipper", "profiles", "ghosted", "profile.json"),
      JSON.stringify({ agent: "claude", createdAt: "" }),
    );
    const config = structuredClone(DEFAULT_CONFIG);
    config.profiles = { ghosted: { hidden: true }, vanished: { label: "gone" } };
    config.providers.claude.defaultProfileName = "nope";
    const report = doctorReport(config);
    expect(report).toContain("hidden but its data remains");
    expect(report).toContain("[profiles.vanished] references a profile that no longer exists");
    expect(report).toContain("Claude default 'nope' does not exist");
    expect(report).toContain("claude/default: needs login"); // empty test home has no creds
  });

  test("clean setup reports no profile warnings", () => {
    const report = doctorReport(structuredClone(DEFAULT_CONFIG));
    expect(report).toContain("no config file yet");
    expect(report).not.toContain("references a profile");
  });
});
