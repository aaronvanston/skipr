import { describe, expect, test } from "bun:test";
import { resetsIn, tierLabel, barCells, barColor, displayEmail, windowPace, paceColor, DEFAULT_THRESHOLDS, type Thresholds } from "./format";

const NOW = Date.parse("2026-06-11T00:00:00Z");

describe("resetsIn", () => {
  test("hours and minutes", () => {
    expect(resetsIn("2026-06-11T04:53:30Z", NOW)).toBe("4h 53m");
  });
  test("days and hours", () => {
    expect(resetsIn("2026-06-13T05:10:00Z", NOW)).toBe("2d 5h");
  });
  test("minutes only", () => {
    expect(resetsIn("2026-06-11T00:42:00Z", NOW)).toBe("42m");
  });
  test("past timestamps say now", () => {
    expect(resetsIn("2026-06-10T00:00:00Z", NOW)).toBe("now");
  });
  test("garbage says ?", () => {
    expect(resetsIn("not-a-date", NOW)).toBe("?");
  });
});

describe("tierLabel", () => {
  test("max tiers", () => {
    expect(tierLabel("default_claude_max_20x")).toBe("Max 20x");
    expect(tierLabel("default_claude_max_5x")).toBe("Max 5x");
  });
  test("pro", () => {
    expect(tierLabel("default_claude_pro")).toBe("Pro");
  });
  test("team", () => {
    expect(tierLabel("default_claude_team")).toBe("Team");
  });
  test("unknown passes through, missing is null", () => {
    expect(tierLabel("weird_tier")).toBe("weird_tier");
    expect(tierLabel(null)).toBeNull();
    expect(tierLabel(undefined)).toBeNull();
  });
});

describe("bar helpers", () => {
  test("barCells maps utilization to cells", () => {
    expect(barCells(0)).toBe(0);
    expect(barCells(92)).toBe(9);
    expect(barCells(100)).toBe(10);
    expect(barCells(250)).toBe(10); // clamped
    expect(barCells(-5)).toBe(0);   // clamped
  });
  test("barColor default thresholds: >60 yellow, >85 red", () => {
    expect(barColor(10)).toBe("green");
    expect(barColor(60)).toBe("green");
    expect(barColor(61)).toBe("yellow");
    expect(barColor(85)).toBe("yellow");
    expect(barColor(86)).toBe("red");
  });
  test("barColor explicit DEFAULT_THRESHOLDS matches default behavior", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ warn: 60, danger: 85 });
    expect(barColor(61, DEFAULT_THRESHOLDS)).toBe("yellow");
    expect(barColor(86, DEFAULT_THRESHOLDS)).toBe("red");
  });
  test("barColor respects custom thresholds", () => {
    const t: Thresholds = { warn: 30, danger: 50 };
    expect(barColor(30, t)).toBe("green");
    expect(barColor(31, t)).toBe("yellow");
    expect(barColor(50, t)).toBe("yellow");
    expect(barColor(51, t)).toBe("red");
    // values that would change color under defaults stay green with high thresholds
    expect(barColor(86, { warn: 90, danger: 95 })).toBe("green");
  });
});

describe("displayEmail", () => {
  test("show passes through, hide returns null", () => {
    expect(displayEmail("a@b.com", "show")).toBe("a@b.com");
    expect(displayEmail("a@b.com", "hide")).toBeNull();
    expect(displayEmail(null, "show")).toBeNull();
  });
});

describe("windowPace", () => {
  const NOW2 = Date.parse("2026-06-11T00:00:00Z");
  test("5h window nearly over: high usage still reads under pace", () => {
    // resets in 1m → ~99.7% of the window elapsed; 72% used → ~-28% under pace
    const pace = windowPace("five_hour", 72, new Date(NOW2 + 60_000).toISOString(), NOW2)!;
    expect(Math.round(pace.expected)).toBe(100);
    expect(Math.round(pace.delta)).toBe(-28);
  });
  test("7d window: ahead of pace is positive", () => {
    // resets in 3d12h → 50% elapsed; 59% used → +9 over pace
    const resetsAt = new Date(NOW2 + 3.5 * 24 * 3600_000).toISOString();
    const pace = windowPace("seven_day", 59, resetsAt, NOW2)!;
    expect(Math.round(pace.expected)).toBe(50);
    expect(Math.round(pace.delta)).toBe(9);
  });
  test("fresh window: delta equals utilization", () => {
    const resetsAt = new Date(NOW2 + 5 * 3600_000).toISOString();
    expect(windowPace("five_hour", 12, resetsAt, NOW2)!.delta).toBeCloseTo(12, 5);
  });
  test("unknown windows and garbage dates yield null", () => {
    expect(windowPace("seven_day_opus", 50, new Date(NOW2).toISOString(), NOW2)).toBeNull();
    expect(windowPace("five_hour", 50, "garbage", NOW2)).toBeNull();
  });
  test("clamps when reset time exceeds the window length", () => {
    const resetsAt = new Date(NOW2 + 10 * 3600_000).toISOString(); // > 5h away
    expect(windowPace("five_hour", 40, resetsAt, NOW2)!.expected).toBe(0);
  });
});

describe("paceColor", () => {
  test("over pace warms up, under pace is green", () => {
    expect(paceColor(-5)).toBe("green");
    expect(paceColor(0)).toBe("green");
    expect(paceColor(8)).toBe("yellow");
    expect(paceColor(16)).toBe("red");
  });
});
