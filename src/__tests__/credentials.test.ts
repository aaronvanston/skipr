import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCredBlob, credBlob, readCreds, writeCreds } from "../providers/claude/credentials";
import type { OauthCreds } from "../types";

const CREDS: OauthCreds = {
  accessToken: "at-1",
  refreshToken: "rt-1",
  expiresAt: 1760000000000,
  scopes: ["user:profile"],
  subscriptionType: "max",
  rateLimitTier: "default_claude_max_20x",
};

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skipper-test-"));
  process.env.SKIPPER_CLAUDE_HOME = join(tmp, ".claude");
});
afterEach(() => {
  delete process.env.SKIPPER_CLAUDE_HOME;
  rmSync(tmp, { recursive: true, force: true });
});

describe("blob parse/serialize", () => {
  test("round-trips all fields", () => {
    expect(parseCredBlob(credBlob(CREDS))).toEqual(CREDS);
  });
  test("rejects garbage and incomplete blobs", () => {
    expect(parseCredBlob("not json")).toBeNull();
    expect(parseCredBlob("{}")).toBeNull();
    expect(parseCredBlob('{"claudeAiOauth":{"accessToken":"x"}}')).toBeNull();
  });
  test("missing optional fields survive", () => {
    const min: OauthCreds = { accessToken: "a", refreshToken: "r", expiresAt: 5 };
    expect(parseCredBlob(credBlob(min))).toEqual(min);
  });
});

describe("file fallback read/write", () => {
  // A fresh temp config dir has no matching keychain entry, so readCreds
  // exercises the keychain-miss → file path.
  test("reads .credentials.json when keychain has no entry", async () => {
    const dir = join(tmp, "profiles", "work");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".credentials.json"), credBlob(CREDS));
    const got = await readCreds(dir);
    expect(got).toEqual({ creds: CREDS, source: "file" });
  });

  test("returns null when nothing exists", async () => {
    const dir = join(tmp, "profiles", "empty");
    mkdirSync(dir, { recursive: true });
    expect(await readCreds(dir)).toBeNull();
  });

  test("writeCreds with file source writes 0600 atomic file", async () => {
    const dir = join(tmp, "profiles", "work");
    mkdirSync(dir, { recursive: true });
    await writeCreds(dir, CREDS, "file");
    const p = join(dir, ".credentials.json");
    expect(JSON.parse(readFileSync(p, "utf8")).claudeAiOauth.accessToken).toBe("at-1");
    expect(statSync(p).mode & 0o777).toBe(0o600);
  });
});
