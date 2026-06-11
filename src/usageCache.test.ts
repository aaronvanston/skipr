import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadUsageCache, saveUsageCache } from "./usageCache";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skipper-test-"));
  process.env.SKIPPER_HOME = join(tmp, ".skipper");
});
afterEach(() => {
  delete process.env.SKIPPER_HOME;
  rmSync(tmp, { recursive: true, force: true });
});

describe("usage cache", () => {
  test("empty when missing, round-trips", () => {
    expect(loadUsageCache()).toEqual({});
    const cache = {
      default: {
        fetchedAt: 123,
        windows: { five_hour: { utilization: 92, resetsAt: "2026-06-11T05:00:00Z" } },
      },
    };
    saveUsageCache(cache);
    expect(loadUsageCache()).toEqual(cache);
  });
});
