import React from "react";
import { Box, Text } from "ink";
import type { SessionInfo } from "../types";
import { resetsIn } from "../format";

function age(mtimeMs: number): string {
  // resetsIn formats a future delta; feed it the mirrored timestamp
  return resetsIn(new Date(Date.now() + (Date.now() - mtimeMs)).toISOString()) + " ago";
}

export function SessionPicker({ sessions, selected }: { sessions: SessionInfo[]; selected: number }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Move which session into this profile? (esc to cancel)</Text>
      {sessions.slice(0, 10).map((session, i) => (
        <Text key={session.id} color={i === selected ? "cyan" : undefined} bold={i === selected}>
          {i === selected ? "❯ " : "  "}
          [{session.profileName.padEnd(8)}] {age(session.mtimeMs).padEnd(10)} {session.snippet}
        </Text>
      ))}
    </Box>
  );
}
