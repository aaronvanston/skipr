import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig, saveConfig, getConfigValue, setConfigValue, unsetConfigValue } from "../config";
import { parse as parseToml } from "smol-toml";
import { legacyConfigJsonPath } from "../paths";
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
    expect(loadConfig().providers.claude.sharedItems).toContain("skills");
    expect(loadConfig().providers.codex.sharedItems).toEqual([]);
  });

  test("saveConfig round-trips and merges over defaults on load", () => {
    const custom = structuredClone(DEFAULT_CONFIG);
    custom.providers.claude.launchCommand = "claude --dangerously-skip-permissions";
    saveConfig(custom);
    const loaded = loadConfig();
    expect(loaded.providers.claude.launchCommand).toBe("claude --dangerously-skip-permissions");
    expect(loaded.providers.codex.launchCommand).toBe("codex"); // untouched provider keeps default
    expect(loaded.providers.claude.sharedItems).toEqual(DEFAULT_CONFIG.providers.claude.sharedItems);
    // file is valid TOML
    const raw = parseToml(readFileSync(configPath(), "utf8")) as { providers: { claude: { launchCommand: string } } };
    expect(raw.providers.claude.launchCommand).toBe("claude --dangerously-skip-permissions");
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
    // partial JSON config written by an older version - no thresholds key at all
    writeFileSync(legacyConfigJsonPath(), JSON.stringify({ defaultLaunchCommand: "claude --foo" }));
    const loaded = loadConfig();
    expect(loaded.providers.claude.launchCommand).toBe("claude --foo"); // legacy key migrates
    expect(loaded.thresholds).toEqual({ warn: 60, danger: 85 });
    expect(loaded.providers.claude.sharedItems).toEqual(DEFAULT_CONFIG.providers.claude.sharedItems);
  });

  test("loadConfig keeps custom thresholds from the file", () => {
    saveConfig({ ...DEFAULT_CONFIG, thresholds: { warn: 40, danger: 70 } });
    expect(loadConfig().thresholds).toEqual({ warn: 40, danger: 70 });
  });

  test("partial thresholds override deep-merges per key over defaults", () => {
    mkdirSync(join(tmp, ".skipper"), { recursive: true });
    writeFileSync(configPath(), '[thresholds]\nwarn = 50\n');
    expect(loadConfig().thresholds).toEqual({ warn: 50, danger: 85 });
  });

  test("non-numeric threshold values fall back to defaults per key", () => {
    mkdirSync(join(tmp, ".skipper"), { recursive: true });
    writeFileSync(configPath(), '[thresholds]\nwarn = "high"\ndanger = 70\n');
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
    const legacyLoad = (fixture: object) => {
      rmSync(configPath(), { force: true }); // each legacy load gets a fresh migration
      writeFileSync(legacyConfigJsonPath(), JSON.stringify(fixture));
      return loadConfig();
    };
    expect(legacyLoad({ anonymizeEmails: true }).emailDisplay).toBe("hide");
    expect(legacyLoad({ emailDisplay: "mask" }).emailDisplay).toBe("hide");
    expect(legacyLoad({ anonymizeEmails: true, emailDisplay: "show" }).emailDisplay).toBe("show");
  });

  test("invalid emailDisplay values fall back to show", () => {
    writeFileSync(configPath(), 'emailDisplay = "nonsense"\n');
    expect(loadConfig().emailDisplay).toBe("show");
  });
});

describe("provider config migration", () => {
  test("legacy flat keys migrate into providers and are stripped", () => {
    writeFileSync(legacyConfigJsonPath(), JSON.stringify({
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
    // migration persisted: TOML written, JSON renamed to .bak
    expect(readFileSync(configPath(), "utf8")).toContain("[providers.claude]");
    expect(() => readFileSync(legacyConfigJsonPath(), "utf8")).toThrow();
  });

  test("explicit providers keys beat legacy keys", () => {
    writeFileSync(legacyConfigJsonPath(), JSON.stringify({
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

describe("config schema extras", () => {
  test("legacy top-level sharedItems migrates to claude's provider", () => {
    rmSync(configPath(), { force: true });
    writeFileSync(legacyConfigJsonPath(), JSON.stringify({ sharedItems: ["skills"] }));
    const loaded = loadConfig();
    expect(loaded.providers.claude.sharedItems).toEqual(["skills"]);
    expect("sharedItems" in loaded).toBe(false);
  });

  test("profile overlays merge and hidden filters; schema validates set", () => {
    const c = structuredClone(DEFAULT_CONFIG);
    setConfigValue(c, "profiles.work2.label", "Personal");
    setConfigValue(c, "profiles.work2.hidden", "true");
    expect(c.profiles?.work2).toEqual({ label: "Personal", hidden: true });
    expect(() => setConfigValue(c, "profiles.work2.nope", "1")).toThrow(/unknown config key/);
    expect(() => setConfigValue(c, "thresholds", "5")).toThrow(/is a section/);
    expect(() => setConfigValue(c, "emailDisplay", "purple")).toThrow(/one of/);
    expect(() => setConfigValue(c, "thresholds.warn", "high")).toThrow(/expected a number/);
    setConfigValue(c, "providers.claude.sharedItems", '["skills","CLAUDE.md"]');
    expect(c.providers.claude.sharedItems).toEqual(["skills", "CLAUDE.md"]);
  });

  test("unsetConfigValue reverts optionals", () => {
    const c = structuredClone(DEFAULT_CONFIG);
    setConfigValue(c, "providers.claude.defaultProfileName", "work2");
    unsetConfigValue(c, "providers.claude.defaultProfileName");
    expect(c.providers.claude.defaultProfileName).toBeUndefined();
    expect(() => unsetConfigValue(c, "bogus.path")).toThrow(/unknown config key/);
  });
});
