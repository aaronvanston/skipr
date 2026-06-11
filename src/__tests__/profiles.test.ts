import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listProfiles, createProfile, deleteProfile, readIdentity, saveLaunchCommand, saveLabel,
} from "../profiles";
import { DEFAULT_CONFIG, loadConfig } from "../config";
import type { SkipperConfig } from "../types";

let tmp: string;
let config: SkipperConfig;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skipper-test-"));
  process.env.SKIPPER_HOME = join(tmp, ".skipper");
  process.env.SKIPPER_CLAUDE_HOME = join(tmp, ".claude");
  process.env.SKIPPER_CODEX_HOME = join(tmp, ".codex"); // absent → no codex default row
  mkdirSync(join(tmp, ".claude", "skills"), { recursive: true });
  writeFileSync(join(tmp, ".claude", "CLAUDE.md"), "# global\n");
  config = structuredClone(DEFAULT_CONFIG);
});
afterEach(() => {
  delete process.env.SKIPPER_HOME;
  delete process.env.SKIPPER_CLAUDE_HOME;
  delete process.env.SKIPPER_CODEX_HOME;
  rmSync(tmp, { recursive: true, force: true });
});

describe("listProfiles", () => {
  test("always includes default first, then dirs sorted", () => {
    createProfile("work", config);
    createProfile("alpha", config);
    const names = listProfiles(config).map((p) => p.name);
    expect(names).toEqual(["default", "alpha", "work"]);
    expect(listProfiles(config)[0].configDir).toBeNull();
  });

  test("default profile picks up launchCommand from providers.claude.defaultProfile", () => {
    config.providers.claude.defaultProfile = { launchCommand: "claude --fast" };
    expect(listProfiles(config)[0].meta.launchCommand).toBe("claude --fast");
  });
});

describe("createProfile", () => {
  test("creates dir, profile.json, and shared symlinks for existing items", () => {
    const p = createProfile("work", config);
    expect(p.configDir).toBe(join(tmp, ".skipper", "profiles", "work"));
    expect(existsSync(join(p.configDir!, "profile.json"))).toBe(true);
    // skills/ and CLAUDE.md exist in claude home → symlinked; agents/ etc. don't → skipped
    expect(lstatSync(join(p.configDir!, "skills")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(p.configDir!, "CLAUDE.md")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(p.configDir!, "agents"))).toBe(false);
  });

  test("rejects bad names and duplicates", () => {
    expect(() => createProfile("../evil", config)).toThrow();
    expect(() => createProfile("default", config)).toThrow();
    createProfile("work", config);
    expect(() => createProfile("work", config)).toThrow();
  });
});

describe("deleteProfile", () => {
  test("removes profile dirs, refuses default and outside paths", () => {
    const p = createProfile("work", config);
    deleteProfile(p);
    expect(existsSync(p.configDir!)).toBe(false);
    expect(() => deleteProfile(listProfiles(config)[0])).toThrow(); // default
    expect(() =>
      deleteProfile({ name: "x", configDir: join(tmp, ".claude"), meta: p.meta }),
    ).toThrow(); // outside profiles dir
  });
});

describe("identity + launch command persistence", () => {
  test("readIdentity pulls email/tier from .claude.json; missing file is null", () => {
    const p = createProfile("work", config);
    expect(readIdentity(p)).toEqual({ email: null, tier: null });
    writeFileSync(
      join(p.configDir!, ".claude.json"),
      JSON.stringify({
        oauthAccount: {
          emailAddress: "a@b.com",
          organizationRateLimitTier: "default_claude_max_5x",
        },
      }),
    );
    expect(readIdentity(p)).toEqual({ email: "a@b.com", tier: "default_claude_max_5x" });
  });

  test("saveLaunchCommand writes profile.json for named profiles", () => {
    const p = createProfile("work", config);
    saveLaunchCommand(p, "claude --dangerously-skip-permissions");
    const again = listProfiles(config).find((x) => x.name === "work")!;
    expect(again.meta.launchCommand).toBe("claude --dangerously-skip-permissions");
    // other meta fields survive the rewrite
    expect(again.meta.agent).toBe("claude");
    expect(again.meta.createdAt).toBe(p.meta.createdAt);
  });

  test("saveLaunchCommand writes config.json for the default profile", () => {
    saveLaunchCommand(listProfiles(config)[0], "claude --fast");
    expect(loadConfig().providers.claude.defaultProfile?.launchCommand).toBe("claude --fast");
  });
});

describe("saveLabel", () => {
  test("writes label to profile.json for named profiles; empty clears it", () => {
    const p = createProfile("work", config);
    saveLabel(p, "Work - Acme");
    let again = listProfiles(config).find((x) => x.name === "work")!;
    expect(again.meta.label).toBe("Work - Acme");
    expect(again.meta.agent).toBe("claude"); // other meta survives
    saveLabel(again, "");
    again = listProfiles(config).find((x) => x.name === "work")!;
    expect(again.meta.label).toBeUndefined();
  });

  test("writes config.json defaultProfile.label for the default profile", () => {
    saveLabel(listProfiles(config)[0], "Main");
    expect(loadConfig().providers.claude.defaultProfile?.label).toBe("Main");
    expect(listProfiles(loadConfig())[0].meta.label).toBe("Main");
  });
});

describe("codex profiles", () => {
  test("codex default appears only when the codex home exists, after claude profiles", () => {
    createProfile("work", config);
    expect(listProfiles(config).map((p) => p.name)).toEqual(["default", "work"]);
    mkdirSync(join(tmp, ".codex"), { recursive: true });
    const profiles = listProfiles(config);
    expect(profiles.map((p) => p.name)).toEqual(["default", "work", "codex"]);
    expect(profiles[2].meta.agent).toBe("codex");
    expect(profiles[2].configDir).toBeNull();
  });

  test("named codex profiles sort into the codex section and skip symlinks", () => {
    mkdirSync(join(tmp, ".codex"), { recursive: true });
    const p = createProfile("cx-work", config, "codex");
    expect(p.meta.agent).toBe("codex");
    expect(existsSync(join(p.configDir!, "skills"))).toBe(false); // no claude symlinks
    expect(listProfiles(config).map((x) => x.name)).toEqual(["default", "codex", "cx-work"]);
  });

  test("'codex' is a reserved name", () => {
    expect(() => createProfile("codex", config)).toThrow(/reserved/);
  });

  test("default codex profile saves land in providers.codex.defaultProfile", () => {
    mkdirSync(join(tmp, ".codex"), { recursive: true });
    const codexDefault = listProfiles(config).find((p) => p.name === "codex")!;
    saveLaunchCommand(codexDefault, "codex --full-auto");
    saveLabel(codexDefault, "GPT");
    const loaded = loadConfig();
    expect(loaded.providers.codex.defaultProfile?.launchCommand).toBe("codex --full-auto");
    expect(loaded.providers.codex.defaultProfile?.label).toBe("GPT");
    expect(loaded.providers.claude.defaultProfile).toBeUndefined(); // claude default untouched
  });

  test("defaultProvider codex lists the codex section first", () => {
    mkdirSync(join(tmp, ".codex"), { recursive: true });
    createProfile("work", config);
    const flipped = { ...config, defaultProvider: "codex" as const };
    expect(listProfiles(flipped).map((p) => p.name)).toEqual(["codex", "default", "work"]);
  });
});
