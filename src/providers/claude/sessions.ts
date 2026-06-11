import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, readdirSync, statSync,
} from "node:fs";
import { join } from "node:path";
import type { Profile, SessionInfo } from "../../types";
import { claudeHome } from "../../paths";

/** Claude Code's projects-dir encoding of a project path. */
export function projectSlug(projectDir: string): string {
  return projectDir.replace(/[^a-zA-Z0-9]/g, "-");
}

function projectsDirFor(profile: Profile, projectDir: string): string {
  return join(profile.configDir ?? claudeHome(), "projects", projectSlug(projectDir));
}

/** First user message from the head of a transcript (reads at most 64KB). */
export function firstUserSnippet(path: string, maxLen = 60): string {
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(65536);
  const n = readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  for (const line of buf.toString("utf8", 0, n).split("\n")) {
    try {
      const entry = JSON.parse(line);
      if (entry?.type !== "user") continue;
      const content = entry.message?.content;
      const text =
        typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content
                .filter((b: { type?: string }) => b?.type === "text")
                .map((b: { text?: string }) => b.text ?? "")
                .join(" ")
            : "";
      const cleaned = text.replace(/\s+/g, " ").trim();
      if (cleaned) return cleaned.length > maxLen ? cleaned.slice(0, maxLen - 1) + "…" : cleaned;
    } catch {
      // partial/garbled line (e.g. truncated by the 64KB cap) - skip
    }
  }
  return "(no message)";
}

export function listSessionsForProject(
  projectDir: string,
  profiles: Profile[],
  excludeProfile: string,
): SessionInfo[] {
  const sessions: SessionInfo[] = [];
  for (const profile of profiles) {
    if (profile.name === excludeProfile) continue;
    const dir = projectsDirFor(profile, projectDir);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".jsonl")) continue;
      const path = join(dir, file);
      sessions.push({
        id: file.slice(0, -".jsonl".length),
        profileName: profile.name,
        path,
        mtimeMs: statSync(path).mtimeMs,
        snippet: firstUserSnippet(path),
      });
    }
  }
  return sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Copy (never move) a transcript into the target profile so --resume works there.
 * Never clobbers a newer target copy (e.g. re-hopping a session that already
 * progressed in the target profile): copies only if missing or source is newer. */
export function copySessionTo(session: SessionInfo, target: Profile, projectDir: string): string {
  const destDir = projectsDirFor(target, projectDir);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, `${session.id}.jsonl`);
  const destStat = statSync(dest, { throwIfNoEntry: false });
  if (!destStat || session.mtimeMs > destStat.mtimeMs) {
    copyFileSync(session.path, dest);
  }
  return session.id;
}
