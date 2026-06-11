import React from "react";
import { Box, Text } from "ink";

const KEYS: Array<[string, string]> = [
  ["↑↓", "select"],
  ["⏎", "launch"],
  ["m", "move session"],
  ["n", "new"],
  ["e", "edit"],
  ["c", "config"],
  ["r", "refresh"],
  ["q", "quit"],
];

export function StatusFooter() {
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} marginTop={1}>
      <Text>
        {KEYS.map(([key, label], i) => (
          <Text key={key}>
            {i > 0 && <Text dimColor> · </Text>}
            <Text color="cyan">{key}</Text>
            <Text dimColor>{` ${label}`}</Text>
          </Text>
        ))}
      </Text>
    </Box>
  );
}
