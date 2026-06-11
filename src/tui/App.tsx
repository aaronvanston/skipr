import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type {
  Identity, SkipperConfig, PendingAction, Profile, SessionInfo, UsageCache, UsageSnapshot,
} from "../types";
import { resolveLaunchCommand } from "../launch";
import { ProfileRow } from "./ProfileRow";
import { SessionPicker } from "./SessionPicker";
import { StatusFooter } from "./StatusFooter";

export interface AppServices {
  profiles: Profile[];
  identities: Record<string, Identity>;
  config: SkipperConfig;
  loadCache(): UsageCache;
  fetchUsage(profile: Profile): Promise<UsageSnapshot>;
  saveCache(cache: UsageCache): void;
  createProfile(name: string): Profile;
  deleteProfile(profile: Profile): void;
  saveLaunchCommand(profile: Profile, command: string): void;
  saveLabel(profile: Profile, label: string): void;
  listSessions(profiles: Profile[], excludeProfile: string): SessionInfo[];
  copySession(session: SessionInfo, target: Profile): string;
  onDone(action: PendingAction): void;
}

type Mode = "list" | "editMenu" | "new" | "edit" | "delete" | "label" | "sessions";

const DASHED_BORDER = {
  topLeft: "┌", top: "┄", topRight: "┐",
  left: "┆", right: "┆",
  bottomLeft: "└", bottom: "┄", bottomRight: "┘",
} as const;

type EditMenuItem = "Label" | "Launch command" | "Delete profile";

function editMenuItems(profile: Profile): EditMenuItem[] {
  const items: EditMenuItem[] = ["Label", "Launch command"];
  if (profile.configDir) items.push("Delete profile"); // default profile is undeletable
  return items;
}

export function App(props: AppServices) {
  const { exit } = useApp();
  const [mode, setMode] = useState<Mode>("list");
  const [selected, setSelected] = useState(0);
  const [input, setInput] = useState("");
  const [usage, setUsage] = useState<UsageCache>(() => props.loadCache());
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [editIdx, setEditIdx] = useState(0);
  const [sessionIdx, setSessionIdx] = useState(0);
  const [message, setMessage] = useState("");

  // invariant: profiles is never empty - index.tsx always seeds the default profile
  const current = props.profiles[selected];

  function done(action: PendingAction) {
    props.onDone(action);
    exit();
  }

  function refresh() {
    for (const profile of props.profiles) {
      setLoading((l) => ({ ...l, [profile.name]: true }));
      props
        .fetchUsage(profile)
        .then((snap) => {
          setUsage((u) => {
            const next = { ...u, [profile.name]: snap };
            props.saveCache(next);
            return next;
          });
        })
        .finally(() => setLoading((l) => ({ ...l, [profile.name]: false })));
    }
  }
  useEffect(refresh, []);

  useInput(
    (ch, key) => {
      setMessage("");
      if (mode === "list") {
        if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
        else if (key.downArrow) setSelected((i) => Math.min(props.profiles.length - 1, i + 1));
        else if (key.return) {
          if (usage[current.name]?.error === "needs login" && current.configDir) {
            done({ type: "login", profile: current });
          } else {
            done({ type: "launch", profile: current, extraArgs: [] });
          }
        } else if (ch === "q") done({ type: "quit" });
        else if (ch === "r") refresh();
        else if (ch === "n") {
          setInput("");
          setMode("new");
        } else if (ch === "e") {
          setEditIdx(0);
          setMode("editMenu");
        } else if (ch === "c") {
          done({ type: "config" });
        } else if (ch === "m") {
          const found = props.listSessions(props.profiles, current.name);
          if (found.length === 0) setMessage("no sessions for this project in other profiles");
          else {
            setSessions(found);
            setSessionIdx(0);
            setMode("sessions");
          }
        }
      } else if (mode === "editMenu") {
        const items = editMenuItems(current);
        if (key.escape) setMode("list");
        else if (key.upArrow) setEditIdx((i) => Math.max(0, i - 1));
        else if (key.downArrow) setEditIdx((i) => Math.min(items.length - 1, i + 1));
        else if (key.return) {
          const picked = items[editIdx];
          if (picked === "Label") {
            setInput(current.meta.label ?? "");
            setMode("label");
          } else if (picked === "Launch command") {
            setInput(resolveLaunchCommand(current, props.config));
            setMode("edit");
          } else {
            setInput("");
            setMode("delete");
          }
        }
      } else if (mode === "sessions") {
        if (key.escape) setMode("list");
        else if (key.upArrow) setSessionIdx((i) => Math.max(0, i - 1));
        else if (key.downArrow) setSessionIdx((i) => Math.min(sessions.length - 1, i + 1));
        else if (key.return) {
          const id = props.copySession(sessions[sessionIdx], current);
          done({ type: "launch", profile: current, extraArgs: ["--resume", id] });
        }
      }
    },
    { isActive: mode === "list" || mode === "sessions" || mode === "editMenu" },
  );

  // escape backs out of text-input modes
  useInput(
    (_ch, key) => {
      if (key.escape) setMode(mode === "new" ? "list" : "editMenu");
    },
    { isActive: mode === "new" || mode === "edit" || mode === "delete" || mode === "label" },
  );

  function submitNew(name: string) {
    try {
      const profile = props.createProfile(name.trim());
      done({ type: "login", profile });
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
      setMode("list");
    }
  }

  function submitEdit(command: string) {
    try {
      props.saveLaunchCommand(current, command.trim());
      done({ type: "reload" });
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
      setMode("list");
    }
  }

  function submitLabel(label: string) {
    try {
      props.saveLabel(current, label);
      done({ type: "reload" });
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
      setMode("list");
    }
  }

  function submitDelete(typed: string) {
    if (typed.trim() !== current.name) {
      setMessage("name did not match - not deleted");
      setMode("list");
      return;
    }
    try {
      props.deleteProfile(current);
      done({ type: "reload" });
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
      setMode("list");
    }
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>skipr</Text>
      <Text> </Text>
      <Text bold color="cyan">
        › Claude
      </Text>
      {props.profiles.map((profile, i) => (
        <ProfileRow
          key={profile.name}
          profile={profile}
          identity={props.identities[profile.name] ?? { email: null, tier: null }}
          usage={usage[profile.name]}
          loading={loading[profile.name] ?? false}
          selected={i === selected && mode === "list"}
          thresholds={props.config.thresholds}
          emailDisplay={props.config.emailDisplay}
        />
      ))}
      <Box borderStyle={DASHED_BORDER} borderColor="gray" paddingX={1}>
        <Text dimColor>+ Add profile (n)</Text>
      </Box>
      {mode === "editMenu" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Edit {current.meta.label ?? current.name} (esc to cancel)</Text>
          {editMenuItems(current).map((item, i) => (
            <Text key={item} color={i === editIdx ? "cyan" : undefined} bold={i === editIdx}>
              {i === editIdx ? "❯ " : "  "}
              {item}
            </Text>
          ))}
        </Box>
      )}
      {mode === "sessions" && <SessionPicker sessions={sessions} selected={sessionIdx} />}
      {mode === "new" && (
        <Box marginTop={1}>
          <Text>New profile name: </Text>
          <TextInput value={input} onChange={setInput} onSubmit={submitNew} />
        </Box>
      )}
      {mode === "edit" && (
        <Box marginTop={1}>
          <Text>Launch command for {current.name}: </Text>
          <TextInput value={input} onChange={setInput} onSubmit={submitEdit} />
        </Box>
      )}
      {mode === "label" && (
        <Box marginTop={1}>
          <Text>Label for {current.name} (empty to clear): </Text>
          <TextInput value={input} onChange={setInput} onSubmit={submitLabel} />
        </Box>
      )}
      {mode === "delete" && (
        <Box marginTop={1}>
          <Text color="red">Type the profile name to delete ({current.name}): </Text>
          <TextInput value={input} onChange={setInput} onSubmit={submitDelete} />
        </Box>
      )}
      {message !== "" && (
        <Box marginTop={1}>
          <Text color="yellow">{message}</Text>
        </Box>
      )}
      <StatusFooter />
    </Box>
  );
}
