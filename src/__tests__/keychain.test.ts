import { describe, expect, test, afterAll } from "bun:test";
import { keychainService, keychainRead, keychainWrite, keychainDelete } from "../providers/claude/keychain";
import { createHash } from "node:crypto";

describe("keychainService", () => {
  test("default profile uses the bare service name", () => {
    expect(keychainService(null)).toBe("Claude Code-credentials");
  });
  test("config dirs get an 8-hex sha256 suffix of the path string", () => {
    const dir = "/Users/someone/.skipper/profiles/work";
    const expected = createHash("sha256").update(dir).digest("hex").slice(0, 8);
    expect(keychainService(dir)).toBe(`Claude Code-credentials-${expected}`);
  });
});

// Integration: real `security` round-trip against the login keychain,
// using a throwaway service name so we never touch Claude Code's entries.
const TEST_SERVICE = `skipper-test-${process.pid}`;

describe.skipIf(process.platform !== "darwin")("security CLI round-trip", () => {
  afterAll(async () => {
    await keychainDelete(TEST_SERVICE);
  });

  test("read of a missing service returns null", async () => {
    expect(await keychainRead(`${TEST_SERVICE}-missing`)).toBeNull();
  });

  test("write then read returns the value, update overwrites", async () => {
    expect(await keychainWrite(TEST_SERVICE, '{"hello":1}')).toBe(true);
    expect(await keychainRead(TEST_SERVICE)).toBe('{"hello":1}');
    expect(await keychainWrite(TEST_SERVICE, '{"hello":2}')).toBe(true);
    expect(await keychainRead(TEST_SERVICE)).toBe('{"hello":2}');
  });
});
