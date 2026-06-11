import { describe, expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { App, type AppServices } from "../tui/App";
import type { PendingAction, Profile, SessionInfo, UsageSnapshot } from "../types";
import { DEFAULT_CONFIG } from "../config";

const profiles: Profile[] = [
  { name: "default", configDir: null, meta: { agent: "claude", createdAt: "" } },
  { name: "work", configDir: "/p/work", meta: { agent: "claude", createdAt: "" } },
];

const SNAP: UsageSnapshot = {
  fetchedAt: Date.now(),
  windows: { five_hour: { utilization: 50, resetsAt: new Date(Date.now() + 3600_000).toISOString() } },
};

function makeServices(over: Partial<AppServices> = {}): { services: AppServices; actions: PendingAction[] } {
  const actions: PendingAction[] = [];
  const services: AppServices = {
    profiles,
    identities: {
      default: { email: "a@b.com", tier: "default_claude_max_20x" },
      work: { email: "w@b.com", tier: "default_claude_max_5x" },
    },
    config: DEFAULT_CONFIG,
    loadCache: () => ({}),
    fetchUsage: async () => SNAP,
    mergeSnapshot: (_prev, next) => next,
    saveCache: () => {},
    createProfile: (name, agent) => ({ name, configDir: `/p/${name}`, meta: { agent, createdAt: "" } }),
    deleteProfile: () => {},
    saveLaunchCommand: () => {},
    saveLabel: () => {},
    setDefaultProfile: () => {},
    isDefaultProfile: () => false,
    initialSelection: 0,
    listSessions: () => [],
    copySession: (s) => s.id,
    onDone: (a) => actions.push(a),
    ...over,
  };
  return { services, actions };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("App", () => {
  test("renders profiles and fetched usage", async () => {
    const { services } = makeServices();
    const { lastFrame } = render(<App {...services} />);
    await tick();
    const frame = lastFrame()!;
    expect(frame).toContain("skipr");
    expect(frame).toContain("default");
    expect(frame).toContain("work");
    expect(frame).toContain("50%");
  });

  test("enter launches the selected profile", async () => {
    const { services, actions } = makeServices();
    const { stdin } = render(<App {...services} />);
    await tick();
    stdin.write("\x1b[B"); // down → select work
    await tick();
    stdin.write("\r");
    await tick();
    expect(actions).toEqual([{ type: "launch", profile: profiles[1], extraArgs: [] }]);
  });

  test("enter on a needs-login profile asks for login instead", async () => {
    const { services, actions } = makeServices({
      fetchUsage: async (p) =>
        p.name === "work" ? { fetchedAt: 0, windows: {}, error: "needs login" } : SNAP,
    });
    const { stdin } = render(<App {...services} />);
    await tick();
    stdin.write("\x1b[B");
    await tick();
    stdin.write("\r");
    await tick();
    expect(actions).toEqual([{ type: "login", profile: profiles[1] }]);
  });

  test("q quits", async () => {
    const { services, actions } = makeServices();
    const { stdin } = render(<App {...services} />);
    await tick();
    stdin.write("q");
    await tick();
    expect(actions).toEqual([{ type: "quit" }]);
  });

  test("n prompts for name then agent; picking Codex creates a codex profile and logs in", async () => {
    const created: Array<[string, string]> = [];
    const { services, actions } = makeServices({
      createProfile: (name, agent) => {
        created.push([name, agent]);
        return { name, configDir: `/p/${name}`, meta: { agent, createdAt: "" } };
      },
    });
    const { stdin, lastFrame } = render(<App {...services} />);
    await tick();
    stdin.write("n");
    await tick();
    expect(lastFrame()).toContain("New profile name");
    stdin.write("personal");
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("Agent for personal");
    expect(lastFrame()).toContain("❯ Claude");
    expect(lastFrame()).toContain("Codex");
    stdin.write("\x1b[B"); // → Codex
    await tick();
    stdin.write("\r");
    await tick();
    expect(created).toEqual([["personal", "codex"]]);
    expect(actions).toEqual([
      { type: "login", profile: { name: "personal", configDir: "/p/personal", meta: { agent: "codex", createdAt: "" } } },
    ]);
  });

  test("m with no sessions shows a message; with sessions opens picker and launches with --resume", async () => {
    const session: SessionInfo = {
      id: "sess-1", profileName: "default", path: "/x", mtimeMs: Date.now(), snippet: "old chat",
    };
    const { services, actions } = makeServices({ listSessions: () => [session] });
    const { stdin, lastFrame } = render(<App {...services} />);
    await tick();
    stdin.write("\x1b[B"); // select work
    await tick();
    stdin.write("m");
    await tick();
    expect(lastFrame()).toContain("old chat");
    stdin.write("\r");
    await tick();
    expect(actions).toEqual([{ type: "launch", profile: profiles[1], extraArgs: ["--resume", "sess-1"] }]);
  });

  test("e opens launch-command editor prefilled; submitting saves and reloads", async () => {
    const saved: Array<[string, string]> = [];
    const { services, actions } = makeServices({
      saveLaunchCommand: (p, cmd) => saved.push([p.name, cmd]),
    });
    const { stdin, lastFrame } = render(<App {...services} />);
    await tick();
    stdin.write("e");
    await tick();
    stdin.write("\x1b[B"); // menu → Launch command
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("Launch command for default");
    expect(lastFrame()).toContain("claude"); // prefilled from resolveLaunchCommand
    stdin.write(" --fast");
    await tick();
    stdin.write("\r");
    await tick();
    expect(saved).toEqual([["default", "claude --fast"]]);
    expect(actions).toEqual([{ type: "reload" }]);
  });

  test("edit menu has no Delete for default; deleting a named profile requires its name", async () => {
    const deleted: string[] = [];
    const { services, actions } = makeServices({ deleteProfile: (p) => deleted.push(p.name) });
    const { stdin, lastFrame } = render(<App {...services} />);
    await tick();
    stdin.write("e"); // edit menu on default
    await tick();
    expect(lastFrame()).toContain("Edit default");
    expect(lastFrame()).not.toContain("Delete profile");
    stdin.write("\x1b"); // esc back to list
    await tick();
    stdin.write("\x1b[B"); // select work
    await tick();
    stdin.write("e");
    await tick();
    expect(lastFrame()).toContain("Delete profile");
    stdin.write("\x1b[B"); // → Launch command
    await tick();
    stdin.write("\x1b[B"); // → Set as default
    await tick();
    stdin.write("\x1b[B"); // → Delete profile
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("Type the profile name to delete");
    stdin.write("work");
    await tick();
    stdin.write("\r");
    await tick();
    expect(deleted).toEqual(["work"]);
    expect(actions).toEqual([{ type: "reload" }]);
  });
});

describe("label and anonymize keybinds", () => {
  test("l opens label editor; submitting saves and reloads", async () => {
    const labels: Array<[string, string]> = [];
    const { services, actions } = makeServices({
      saveLabel: (p, label) => labels.push([p.name, label]),
    });
    const { stdin, lastFrame } = render(<App {...services} />);
    await tick();
    stdin.write("e");
    await tick();
    stdin.write("\r"); // menu → Label (first item)
    await tick();
    expect(lastFrame()).toContain("Label for default");
    stdin.write("Main");
    await tick();
    stdin.write("\r");
    await tick();
    expect(labels).toEqual([["default", "Main"]]);
    expect(actions).toEqual([{ type: "reload" }]);
  });

  test("c emits the config action", async () => {
    const { services, actions } = makeServices();
    const { stdin } = render(<App {...services} />);
    await tick();
    stdin.write("c");
    await tick();
    expect(actions).toEqual([{ type: "config" }]);
  });
});
