import React from "react";
import { Text } from "ink";
import { barCells, barColor, type Thresholds } from "../format";

export interface UsageBarProps {
  utilization: number;
  width?: number;
  thresholds?: Thresholds;
  /** even-burn expectation (0-100): renders a │ tick in the empty track */
  expected?: number;
}

export function UsageBar({ utilization, width = 24, thresholds, expected }: UsageBarProps) {
  const filled = barCells(utilization, width);
  let tick = -1;
  if (typeof expected === "number") {
    tick = Math.min(width - 1, barCells(expected, width));
    if (tick < filled) tick = -1; // already burned past it - the delta text tells that story
  }
  return (
    <Text>
      <Text color={barColor(utilization, thresholds)}>{"█".repeat(filled)}</Text>
      {tick >= 0 ? (
        <>
          <Text dimColor>{"░".repeat(tick - filled)}</Text>
          <Text>│</Text>
          <Text dimColor>{"░".repeat(width - tick - 1)}</Text>
        </>
      ) : (
        <Text dimColor>{"░".repeat(width - filled)}</Text>
      )}
    </Text>
  );
}
