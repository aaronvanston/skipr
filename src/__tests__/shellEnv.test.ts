import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeShellEnv } from "../shellEnv";
import { DEFAULT_CONFIG } from "../config";
import { shellEnvPath, profilesDir } from "../paths";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skipper-test-"));
  process.env.SKIPPER_HOME = join(tmp, ".skipper");
  mkdirSync(join(tmp, ".skipper"), { recursive: true });
});
afterEach(() => {
  delete process.env.SKIPPER_HOME;
  rmSync(tmp, { recursive: true, force: true });
});

describe("writeShellEnv", () => {
  test("adopted defaults export nothing; named defaults export the provider home", () => {
    writeShellEnv(structuredClone(DEFAULT_CONFIG));
    let content = readFileSync(shellEnvPath(), "utf8");
    expect(content).not.toContain("export");

    const config = structuredClone(DEFAULT_CONFIG);
    config.providers.claude.defaultProfileName = "work2";
    config.providers.codex.defaultProfileName = "codex2";
    writeShellEnv(config);
    content = readFileSync(shellEnvPath(), "utf8");
    expect(content).toContain(`export CLAUDE_CONFIG_DIR="${join(profilesDir(), "work2")}"`);
    expect(content).toContain(`export CODEX_HOME="${join(profilesDir(), "codex2")}"`);
  });
});
