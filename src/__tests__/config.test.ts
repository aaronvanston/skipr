import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig, saveConfig, getConfigValue, setConfigValue } from "../config";
import { configPath } from "../paths";

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

describe("config", () => {
  test("loadConfig returns defaults when no file exists", () => {
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
    expect(loadConfig().providers.claude.launchCommand).toBe("claude");
    expect(loadConfig().providers.codex.launchCommand).toBe("codex");
    expect(loadConfig().defaultProvider).toBe("claude");
    expect(loadConfig().sharedItems).toContain("skills");
  });

  test("saveConfig round-trips and merges over defaults on load", () => {
    const custom = structuredClone(DEFAULT_CONFIG);
    custom.providers.claude.launchCommand = "claude --dangerously-skip-permissions";
    saveConfig(custom);
    const loaded = loadConfig();
    expect(loaded.providers.claude.launchCommand).toBe("claude --dangerously-skip-permissions");
    expect(loaded.providers.codex.launchCommand).toBe("codex"); // untouched provider keeps default
    expect(loaded.sharedItems).toEqual(DEFAULT_CONFIG.sharedItems);
    // file is valid pretty JSON
    expect(JSON.parse(readFileSync(configPath(), "utf8")).providers.claude.launchCommand)
      .toBe("claude --dangerously-skip-permissions");
  });

  test("corrupt config falls back to defaults", () => {
    saveConfig(DEFAULT_CONFIG);
    writeFileSync(configPath(), "{nope");
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });

  test("DEFAULT_CONFIG ships default thresholds", () => {
    expect(DEFAULT_CONFIG.thresholds).toEqual({ warn: 60, danger: 85 });
  });

  test("loadConfig default-merges thresholds when absent from an existing partial config", () => {
    mkdirSync(join(tmp, ".skipper"), { recursive: true });
    // partial config written by an older version - no thresholds key at all
    writeFileSync(configPath(), JSON.stringify({ defaultLaunchCommand: "claude --foo" }));
    const loaded = loadConfig();
    expect(loaded.providers.claude.launchCommand).toBe("claude --foo"); // legacy key migrates
    expect(loaded.thresholds).toEqual({ warn: 60, danger: 85 });
    expect(loaded.sharedItems).toEqual(DEFAULT_CONFIG.sharedItems);
  });

  test("loadConfig keeps custom thresholds from the file", () => {
    saveConfig({ ...DEFAULT_CONFIG, thresholds: { warn: 40, danger: 70 } });
    expect(loadConfig().thresholds).toEqual({ warn: 40, danger: 70 });
  });

  test("partial thresholds override deep-merges per key over defaults", () => {
    mkdirSync(join(tmp, ".skipper"), { recursive: true });
    writeFileSync(configPath(), JSON.stringify({ thresholds: { warn: 50 } }));
    expect(loadConfig().thresholds).toEqual({ warn: 50, danger: 85 });
  });

  test("non-numeric threshold values fall back to defaults per key", () => {
    mkdirSync(join(tmp, ".skipper"), { recursive: true });
    writeFileSync(configPath(), JSON.stringify({ thresholds: { warn: "high", danger: 70 } }));
    expect(loadConfig().thresholds).toEqual({ warn: 60, danger: 70 });
  });
});

describe("config get/set helpers", () => {
  test("getConfigValue walks dot paths", () => {
    const c = { ...DEFAULT_CONFIG, thresholds: { warn: 50, danger: 80 } };
    expect(getConfigValue(c, "thresholds.warn")).toBe(50);
    expect(getConfigValue(c, "providers.claude.launchCommand")).toBe("claude");
    expect(getConfigValue(c, "nope.deep")).toBeUndefined();
  });

  test("setConfigValue parses JSON values and creates nested objects", () => {
    const c = structuredClone(DEFAULT_CONFIG);
    setConfigValue(c, "thresholds.warn", "55");
    expect(c.thresholds.warn).toBe(55);
    setConfigValue(c, "emailDisplay", "hide");
    expect(c.emailDisplay).toBe("hide");
    setConfigValue(c, "providers.claude.defaultProfile.label", "Main");
    expect(c.providers.claude.defaultProfile?.label).toBe("Main");
    setConfigValue(c, "providers.claude.launchCommand", "claude --fast");
    expect(c.providers.claude.launchCommand).toBe("claude --fast"); // non-JSON stays string
  });

  test("setConfigValue rejects unknown top-level keys", () => {
    const c = structuredClone(DEFAULT_CONFIG);
    expect(() => setConfigValue(c, "typoKey", "1")).toThrow(/unknown config key/);
  });

  test("emailDisplay defaults to show", () => {
    expect(DEFAULT_CONFIG.emailDisplay).toBe("show");
    saveConfig({ ...DEFAULT_CONFIG });
    expect(loadConfig().emailDisplay).toBe("show");
  });

  test("legacy anonymizeEmails:true and the old mask mode map to hide", () => {
    writeFileSync(configPath(), JSON.stringify({ anonymizeEmails: true }));
    expect(loadConfig().emailDisplay).toBe("hide");
    writeFileSync(configPath(), JSON.stringify({ emailDisplay: "mask" }));
    expect(loadConfig().emailDisplay).toBe("hide");
    writeFileSync(configPath(), JSON.stringify({ anonymizeEmails: true, emailDisplay: "show" }));
    expect(loadConfig().emailDisplay).toBe("show"); // explicit key wins
  });

  test("invalid emailDisplay values fall back to show", () => {
    writeFileSync(configPath(), JSON.stringify({ emailDisplay: "nonsense" }));
    expect(loadConfig().emailDisplay).toBe("show");
  });
});

describe("provider config migration", () => {
  test("legacy flat keys migrate into providers and are stripped", () => {
    writeFileSync(configPath(), JSON.stringify({
      defaultLaunchCommand: "claude --dsp",
      codexLaunchCommand: "codex --full-auto",
      defaultProfile: { label: "Main", launchCommand: "claude --resume" },
      codexProfile: { label: "GPT" },
    }));
    const loaded = loadConfig();
    expect(loaded.providers.claude.launchCommand).toBe("claude --dsp");
    expect(loaded.providers.codex.launchCommand).toBe("codex --full-auto");
    expect(loaded.providers.claude.defaultProfile).toEqual({ label: "Main", launchCommand: "claude --resume" });
    expect(loaded.providers.codex.defaultProfile).toEqual({ label: "GPT" });
    for (const legacy of ["defaultLaunchCommand", "codexLaunchCommand", "defaultProfile", "codexProfile"]) {
      expect(legacy in loaded).toBe(false);
    }
  });

  test("explicit providers keys beat legacy keys", () => {
    writeFileSync(configPath(), JSON.stringify({
      defaultLaunchCommand: "old-claude",
      providers: { claude: { launchCommand: "new-claude" } },
    }));
    expect(loadConfig().providers.claude.launchCommand).toBe("new-claude");
  });

  test("invalid defaultProvider falls back to claude", () => {
    writeFileSync(configPath(), JSON.stringify({ defaultProvider: "gemini" }));
    expect(loadConfig().defaultProvider).toBe("claude");
  });
});
