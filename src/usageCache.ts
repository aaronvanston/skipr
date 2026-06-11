import { readFileSync } from "node:fs";
import type { UsageCache } from "./types";
import { usageCachePath } from "./paths";
import { writeFileAtomic } from "./fsutil";

export function loadUsageCache(): UsageCache {
  try {
    return JSON.parse(readFileSync(usageCachePath(), "utf8"));
  } catch {
    return {};
  }
}

export function saveUsageCache(cache: UsageCache): void {
  writeFileAtomic(usageCachePath(), JSON.stringify(cache, null, 2) + "\n");
}
