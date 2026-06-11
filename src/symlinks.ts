import { existsSync, lstatSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { claudeHome } from "./paths";

export interface SyncAction {
  item: string;
  link: string;
  target: string;
  action: "create" | "ok" | "conflict" | "missing-target" | "invalid-name";
}

/** sharedItems entries must be plain names - no separators, no traversal. */
const ITEM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function planSync(configDir: string, sharedItems: string[]): SyncAction[] {
  return sharedItems.map((item) => {
    const target = join(claudeHome(), item);
    const link = join(configDir, item);
    const base = { item, link, target };
    if (!ITEM_RE.test(item) || item.includes("..")) return { ...base, action: "invalid-name" as const };
    if (!existsSync(target)) return { ...base, action: "missing-target" as const };
    const stat = lstatSync(link, { throwIfNoEntry: false });
    if (!stat) return { ...base, action: "create" as const };
    if (stat.isSymbolicLink()) {
      return { ...base, action: readlinkSync(link) === target ? ("ok" as const) : ("create" as const) };
    }
    return { ...base, action: "conflict" as const };
  });
}

/** Executes only "create" actions; a wrong existing symlink is replaced, real
 * files/dirs (conflict) are never touched. Returns the plan for reporting. */
export function applySync(actions: SyncAction[]): SyncAction[] {
  for (const action of actions) {
    if (action.action !== "create") continue;
    rmSync(action.link, { force: true });
    symlinkSync(action.target, action.link);
  }
  return actions;
}
