import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type {
  AgentKind, Identity, SkipperConfig, PendingAction, Profile, SessionInfo, UsageCache, UsageSnapshot,
} from "../types";
import { resolveLaunchCommand } from "../launch";
import { ADAPTERS } from "../providers/registry";
import { ProfileRow } from "./ProfileRow";
import { SessionPicker } from "./SessionPicker";
import { StatusFooter } from "./StatusFooter";

export interface AppServices {
  profiles: Profile[];
  identities: Record<string, Identity>;
  config: SkipperConfig;
  version: string;
  loadCache(): UsageCache;
  fetchUsage(profile: Profile): Promise<UsageSnapshot>;
  mergeSnapshot(previous: UsageSnapshot | undefined, next: UsageSnapshot): UsageSnapshot;
  saveCache(cache: UsageCache): void;
  createProfile(name: string, agent: AgentKind): Profile;
  deleteProfile(profile: Profile): void;
  saveLaunchCommand(profile: Profile, command: string): void;
  saveLabel(profile: Profile, label: string): void;
  setDefaultProfile(profile: Profile): void;
  isDefaultProfile(profile: Profile): boolean;
  initialSelection: number;
  listSessions(profiles: Profile[], excludeProfile: string): SessionInfo[];
  copySession(session: SessionInfo, target: Profile): string;
  onDone(action: PendingAction): void;
}

type Mode = "list" | "editMenu" | "new" | "newAgent" | "edit" | "delete" | "label" | "sessions";

const AGENT_OPTIONS: Array<{ value: AgentKind; title: string }> = Object.values(ADAPTERS).map(
  (adapter) => ({ value: adapter.id, title: adapter.label }),
);

type EditMenuItem = "Label" | "Launch command" | "Set as default" | "Delete profile";

function editMenuItems(profile: Profile, isDefault: boolean): EditMenuItem[] {
  const items: EditMenuItem[] = ["Label", "Launch command"];
  if (!isDefault) items.push("Set as default");
  if (profile.configDir) items.push("Delete profile"); // adopted home profiles are undeletable
  return items;
}

export function App(props: AppServices) {
  const { exit } = useApp();
  const [mode, setMode] = useState<Mode>("list");
  const [selected, setSelected] = useState(props.initialSelection);
  const [input, setInput] = useState("");
  const [usage, setUsage] = useState<UsageCache>(() => props.loadCache());
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [editIdx, setEditIdx] = useState(0);
  const [pendingName, setPendingName] = useState("");
  const [agentIdx, setAgentIdx] = useState(0);
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
            const next = { ...u, [profile.name]: props.mergeSnapshot(u[profile.name], snap) };
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
          if (!ADAPTERS[current.meta.agent].supportsSessionHop) {
            setMessage(`session hop is not supported for ${ADAPTERS[current.meta.agent].label} yet`);
            return;
          }
          const found = props.listSessions(props.profiles, current.name);
          if (found.length === 0) setMessage("no sessions for this project in other profiles");
          else {
            setSessions(found);
            setSessionIdx(0);
            setMode("sessions");
          }
        }
      } else if (mode === "editMenu") {
        const items = editMenuItems(current, props.isDefaultProfile(current));
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
          } else if (picked === "Set as default") {
            try {
              props.setDefaultProfile(current);
              done({ type: "reload" });
            } catch (err) {
              setMessage(String(err instanceof Error ? err.message : err));
              setMode("list");
            }
          } else {
            setInput("");
            setMode("delete");
          }
        }
      } else if (mode === "newAgent") {
        if (key.escape) setMode("list");
        else if (key.upArrow) setAgentIdx((i) => Math.max(0, i - 1));
        else if (key.downArrow) setAgentIdx((i) => Math.min(AGENT_OPTIONS.length - 1, i + 1));
        else if (key.return) {
          try {
            const profile = props.createProfile(pendingName, AGENT_OPTIONS[agentIdx].value);
            done({ type: "login", profile });
          } catch (err) {
            setMessage(String(err instanceof Error ? err.message : err));
            setMode("list");
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
    { isActive: mode === "list" || mode === "sessions" || mode === "editMenu" || mode === "newAgent" },
  );

  // escape backs out of text-input modes
  useInput(
    (_ch, key) => {
      if (key.escape) setMode(mode === "new" ? "list" : "editMenu");
    },
    { isActive: mode === "new" || mode === "edit" || mode === "delete" || mode === "label" },
  );

  function submitNew(name: string) {
    setPendingName(name.trim());
    setAgentIdx(0);
    setMode("newAgent");
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
      <Box>
        <Text color="cyan">{"⛵ "}</Text>
        <Text bold>skipr</Text>
        <Text dimColor>{` v${props.version}`}</Text>
      </Box>
      <Text> </Text>
      {[...new Set(props.profiles.map((p) => p.meta.agent))].map((agent) => {
        const group = props.profiles.filter((p) => p.meta.agent === agent);
        if (group.length === 0) return null;
        return (
          <React.Fragment key={agent}>
            <Text bold color="cyan">
              {`› ${ADAPTERS[agent].label}`}
            </Text>
            {group.map((profile, gi) => {
              const i = props.profiles.indexOf(profile);
              const position =
                group.length === 1 ? "only" : gi === 0 ? "first" : gi === group.length - 1 ? "last" : "middle";
              return (
                <ProfileRow
                  key={profile.name}
                  profile={profile}
                  identity={props.identities[profile.name] ?? { email: null, tier: null }}
                  usage={usage[profile.name]}
                  loading={loading[profile.name] ?? false}
                  selected={i === selected && mode === "list"}
                  thresholds={props.config.thresholds}
                  emailDisplay={props.config.emailDisplay}
                  isDefault={props.isDefaultProfile(profile)}
                  position={position}
                />
              );
            })}
          </React.Fragment>
        );
      })}
      <Text dimColor>  + Add profile (n)</Text>
      {mode === "editMenu" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Edit {current.meta.label ?? current.name} (esc to cancel)</Text>
          {editMenuItems(current, props.isDefaultProfile(current)).map((item, i) => (
            <Text key={item} color={i === editIdx ? "cyan" : undefined} bold={i === editIdx}>
              {i === editIdx ? "❯ " : "  "}
              {item}
            </Text>
          ))}
        </Box>
      )}
      {mode === "sessions" && <SessionPicker sessions={sessions} selected={sessionIdx} />}
      {mode === "newAgent" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{`Agent for ${pendingName} (esc to cancel)`}</Text>
          {AGENT_OPTIONS.map((option, i) => (
            <Text key={option.value} color={i === agentIdx ? "cyan" : undefined} bold={i === agentIdx}>
              {i === agentIdx ? "❯ " : "  "}
              {option.title}
            </Text>
          ))}
        </Box>
      )}
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
