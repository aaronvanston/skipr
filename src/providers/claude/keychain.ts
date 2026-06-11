import { createHash } from "node:crypto";
import { userInfo } from "node:os";

/** Service name Claude Code uses for a given config dir.
 * Matches claudex: sha256 of the absolute path string, first 8 hex chars. */
export function keychainService(configDir: string | null): string {
  if (!configDir) return "Claude Code-credentials";
  const suffix = createHash("sha256").update(configDir).digest("hex").slice(0, 8);
  return `Claude Code-credentials-${suffix}`;
}

async function runSecurity(args: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(["security", ...args], { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

export async function keychainRead(service: string): Promise<string | null> {
  const { code, stdout } = await runSecurity([
    "find-generic-password", "-s", service, "-a", userInfo().username, "-w",
  ]);
  return code === 0 ? stdout.replace(/\n$/, "") : null;
}

export async function keychainWrite(service: string, value: string): Promise<boolean> {
  // -w on argv briefly exposes the value to same-user `ps`; Claude Code writes
  // its own entries the same way, and same-user processes can read the
  // keychain regardless, so we match its behavior.
  const { code } = await runSecurity([
    "add-generic-password", "-U", "-s", service, "-a", userInfo().username, "-w", value,
  ]);
  return code === 0;
}

export async function keychainDelete(service: string): Promise<boolean> {
  const { code } = await runSecurity([
    "delete-generic-password", "-s", service, "-a", userInfo().username,
  ]);
  return code === 0;
}
