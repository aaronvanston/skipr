import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectSlug, listSessionsForProject, copySessionTo, firstUserSnippet } from "./sessions";
import type { Profile } from "./types";

describe("projectSlug", () => {
  test("replaces every non-alphanumeric char with dash", () => {
    expect(projectSlug("/Users/x/my.proj")).toBe("-Users-x-my-proj");
    expect(projectSlug("/Users/a/src/tries/2026-06-11-passport"))
      .toBe("-Users-a-src-tries-2026-06-11-passport");
  });
});

const USER_LINE = JSON.stringify({
  type: "user",
  message: { role: "user", content: "fix the login bug   please" },
});
const USER_BLOCKS_LINE = JSON.stringify({
  type: "user",
  message: { role: "user", content: [{ type: "text", text: "blocks style prompt" }] },
});
const META_LINE = JSON.stringify({ type: "summary", summary: "irrelevant" });

let tmp: string;
let profiles: Profile[];
const PROJECT = "/work/app";

function sessionDir(configDir: string) {
  return join(configDir, "projects", projectSlug(PROJECT));
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "skipper-test-"));
  process.env.SKIPPER_CLAUDE_HOME = join(tmp, ".claude");
  const workDir = join(tmp, "profiles", "work");
  profiles = [
    { name: "default", configDir: null, meta: { agent: "claude", createdAt: "" } },
    { name: "work", configDir: workDir, meta: { agent: "claude", createdAt: "" } },
  ];
  // default profile session (in claudeHome/projects)
  mkdirSync(sessionDir(join(tmp, ".claude")), { recursive: true });
  const a = join(sessionDir(join(tmp, ".claude")), "aaaa-1111.jsonl");
  writeFileSync(a, META_LINE + "\n" + USER_LINE + "\n");
  utimesSync(a, new Date("2026-06-10"), new Date("2026-06-10"));
  // work profile session, newer
  mkdirSync(sessionDir(workDir), { recursive: true });
  const b = join(sessionDir(workDir), "bbbb-2222.jsonl");
  writeFileSync(b, USER_BLOCKS_LINE + "\n");
  utimesSync(b, new Date("2026-06-11"), new Date("2026-06-11"));
});
afterEach(() => {
  delete process.env.SKIPPER_CLAUDE_HOME;
  rmSync(tmp, { recursive: true, force: true });
});

describe("firstUserSnippet", () => {
  test("finds first user message, collapses whitespace", () => {
    const p = join(sessionDir(join(tmp, ".claude")), "aaaa-1111.jsonl");
    expect(firstUserSnippet(p)).toBe("fix the login bug please");
  });
  test("handles content-block arrays", () => {
    const p = join(sessionDir(profiles[1].configDir!), "bbbb-2222.jsonl");
    expect(firstUserSnippet(p)).toBe("blocks style prompt");
  });
});

describe("listSessionsForProject", () => {
  test("lists all profiles' sessions newest-first, excluding the target profile", () => {
    const sessions = listSessionsForProject(PROJECT, profiles, "work");
    expect(sessions.map((s) => s.id)).toEqual(["aaaa-1111"]); // work excluded
    const all = listSessionsForProject(PROJECT, profiles, "nobody");
    expect(all.map((s) => s.id)).toEqual(["bbbb-2222", "aaaa-1111"]); // newest first
    expect(all[0].profileName).toBe("work");
  });
});

describe("copySessionTo", () => {
  test("copies into the target profile's project dir; source survives", () => {
    const [session] = listSessionsForProject(PROJECT, profiles, "work");
    const id = copySessionTo(session, profiles[1], PROJECT);
    expect(id).toBe("aaaa-1111");
    expect(existsSync(join(sessionDir(profiles[1].configDir!), "aaaa-1111.jsonl"))).toBe(true);
    expect(existsSync(session.path)).toBe(true);
  });

  test("does not clobber a newer copy in the target profile", () => {
    // Source session in default profile, with older mtime
    const [session] = listSessionsForProject(PROJECT, profiles, "work");
    // Write distinguishable content into source
    writeFileSync(session.path, "source-content\n");
    utimesSync(session.path, new Date("2026-06-09"), new Date("2026-06-09"));
    // Manually update session.mtimeMs to reflect the older mtime
    session.mtimeMs = new Date("2026-06-09").getTime();

    // Pre-create dest in target profile with NEWER mtime and different content
    const destPath = join(sessionDir(profiles[1].configDir!), `${session.id}.jsonl`);
    writeFileSync(destPath, "newer-dest-content\n");
    utimesSync(destPath, new Date("2026-06-11"), new Date("2026-06-11"));

    const id = copySessionTo(session, profiles[1], PROJECT);
    expect(id).toBe(session.id);
    // Dest content must be unchanged - source must NOT have overwritten it
    expect(readFileSync(destPath, "utf8")).toBe("newer-dest-content\n");
  });

  test("overwrites a stale copy in the target profile", () => {
    // Source session in default profile, with newer mtime
    const [session] = listSessionsForProject(PROJECT, profiles, "work");
    // Write distinguishable content into source
    writeFileSync(session.path, "source-content\n");
    utimesSync(session.path, new Date("2026-06-11"), new Date("2026-06-11"));
    session.mtimeMs = new Date("2026-06-11").getTime();

    // Pre-create dest in target profile with OLDER mtime and different content
    const destPath = join(sessionDir(profiles[1].configDir!), `${session.id}.jsonl`);
    writeFileSync(destPath, "stale-dest-content\n");
    utimesSync(destPath, new Date("2026-06-09"), new Date("2026-06-09"));

    const id = copySessionTo(session, profiles[1], PROJECT);
    expect(id).toBe(session.id);
    // Dest content must now equal source content
    expect(readFileSync(destPath, "utf8")).toBe("source-content\n");
  });
});
