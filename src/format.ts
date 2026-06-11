import type { EmailDisplay } from "./types";

export function resetsIn(resetsAt: string, now = Date.now()): string {
  const ms = Date.parse(resetsAt) - now;
  if (Number.isNaN(ms)) return "?";
  if (ms <= 0) return "now";
  const totalMin = Math.floor(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function tierLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const max = raw.match(/max_(\d+)x/);
  if (max) return `Max ${max[1]}x`;
  if (raw.includes("pro")) return "Pro";
  if (raw.includes("team")) return "Team";
  return raw;
}

/** Anonymous mode removes emails entirely - partial masks still leak shape. */
export function displayEmail(email: string | null, mode: EmailDisplay): string | null {
  if (mode === "hide") return null;
  return email;
}

/** Known usage windows and their lengths; used for pace math and row labels. */
export const WINDOW_LABELS: Array<{ key: string; label: string; lengthMs: number }> = [
  { key: "five_hour", label: "5-hour", lengthMs: 5 * 3600_000 },
  { key: "seven_day", label: "7-day", lengthMs: 7 * 24 * 3600_000 },
];

export interface WindowPace {
  /** utilization you'd have at this point if burning exactly evenly, 0-100 */
  expected: number;
  /** actual minus expected: positive = burning faster than the window refills */
  delta: number;
}

export function windowPace(
  windowKey: string,
  utilization: number,
  resetsAt: string,
  now = Date.now(),
): WindowPace | null {
  const window = WINDOW_LABELS.find((w) => w.key === windowKey);
  if (!window) return null;
  const remaining = Date.parse(resetsAt) - now;
  if (Number.isNaN(remaining)) return null;
  const elapsedFraction = Math.min(1, Math.max(0, 1 - remaining / window.lengthMs));
  const expected = elapsedFraction * 100;
  return { expected, delta: utilization - expected };
}

export function paceColor(delta: number): "green" | "yellow" | "red" {
  if (delta > 15) return "red";
  if (delta > 0) return "yellow";
  return "green";
}

export function barCells(utilization: number, width = 10): number {
  const clamped = Math.min(100, Math.max(0, utilization));
  return Math.round((clamped / 100) * width);
}

export interface Thresholds {
  warn: number;
  danger: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { warn: 60, danger: 85 };

export function barColor(
  utilization: number,
  t: Thresholds = DEFAULT_THRESHOLDS,
): "green" | "yellow" | "red" {
  if (utilization > t.danger) return "red";
  if (utilization > t.warn) return "yellow";
  return "green";
}
