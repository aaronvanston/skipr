import React from "react";
import { Box, Text } from "ink";
import type { EmailDisplay, Identity, Profile, UsageSnapshot } from "../types";
import {
  WINDOW_LABELS, displayEmail, paceColor, resetsIn, tierLabel, windowPace, type Thresholds,
} from "../format";
import { UsageBar } from "./UsageBar";

const BAR_WIDTH = 24;
/** dot(2) + name(10) + email(22) = label(2+6+2) + bar(24) so the │ divider lines up */
const LEFT_WIDTH = 34;

export interface ProfileRowProps {
  profile: Profile;
  identity: Identity;
  usage: UsageSnapshot | undefined;
  loading: boolean;
  selected: boolean;
  thresholds?: Thresholds;
  emailDisplay?: EmailDisplay;
  /** this profile is its provider's default (dashboard preselect, bare launch) */
  isDefault?: boolean;
  /** stacking position within the provider group: cards share edges, so a
   * single separator row sits between profiles instead of two borders */
  position?: "only" | "first" | "middle" | "last";
}

const JOINED_TOP = {
  topLeft: "├", top: "─", topRight: "┤",
  left: "│", right: "│",
  bottomLeft: "╰", bottom: "─", bottomRight: "╯",
} as const;

export function ProfileRow({ profile, identity, usage, loading, selected, thresholds, emailDisplay = "show", isDefault = false, position = "only" }: ProfileRowProps) {
  const tier = tierLabel(identity.tier);
  const displayName = profile.meta.label ?? profile.name;
  const email = identity.email ? (displayEmail(identity.email, emailDisplay) ?? "") : "…";
  const joined = position === "middle" || position === "last";
  return (
    <Box
      flexDirection="column"
      borderStyle={joined ? JOINED_TOP : "round"}
      borderBottom={position === "only" || position === "last"}
      borderColor="gray"
      paddingX={1}
    >
      <Box>
        <Text color={selected ? "cyan" : "gray"}>{selected ? "● " : "○ "}</Text>
        <Text bold={selected} color={selected ? "cyan" : undefined}>{displayName.padEnd(10)}</Text>
        <Text dimColor>{email.padEnd(22)}</Text>
        <Text dimColor>{" │ "}</Text>
        {tier && <Text color="cyan">{`[${tier}]`}</Text>}
        {isDefault && <Text dimColor> · default</Text>}
        {loading && <Text dimColor> ⟳</Text>}
        {usage?.stale && !loading && <Text dimColor> · cached</Text>}
        {usage?.error === "needs login" && <Text color="yellow"> ⚠ needs login · ⏎ to log in</Text>}
      </Box>
      {usage?.error && usage.error !== "needs login" && (
        <Box>
          <Text dimColor>{`${"".padEnd(LEFT_WIDTH)} │ ${usage.error}`}</Text>
        </Box>
      )}
      {WINDOW_LABELS.filter(({ key }) => usage?.windows[key]).map(({ key, label }) => {
        const window = usage!.windows[key];
        const pace = windowPace(key, window.utilization, window.resetsAt);
        return (
          <Box key={key}>
            <Text>{`  ${label.padEnd(6)}: `}</Text>
            <UsageBar
              utilization={window.utilization}
              width={BAR_WIDTH}
              thresholds={thresholds}
              expected={pace?.expected}
            />
            <Text dimColor>{" │ "}</Text>
            <Text bold>{`${window.utilization.toFixed(0).padStart(3)}%`}</Text>
            {pace ? (
              <Text color={paceColor(pace.delta)}>
                {` ${`${pace.delta >= 0 ? "+" : ""}${Math.round(pace.delta)}%`.padEnd(5)}`}
              </Text>
            ) : (
              <Text>{"".padEnd(6)}</Text>
            )}
            <Text dimColor>{`· resets in ${resetsIn(window.resetsAt)}`}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
