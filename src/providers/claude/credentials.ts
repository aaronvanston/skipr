import { existsSync, readFileSync } from "node:fs";
import type { OauthCreds } from "../../types";
import { credentialsPath } from "../../paths";
import { keychainRead, keychainService, keychainWrite } from "./keychain";
import { writeFileAtomic } from "../../fsutil";

export type CredSource = "keychain" | "file";

export function parseCredBlob(raw: string): OauthCreds | null {
  try {
    const oauth = JSON.parse(raw)?.claudeAiOauth;
    if (typeof oauth?.accessToken !== "string" || typeof oauth?.refreshToken !== "string") {
      return null;
    }
    const creds: OauthCreds = {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : 0,
    };
    if (oauth.scopes !== undefined) creds.scopes = oauth.scopes;
    if (oauth.subscriptionType !== undefined) creds.subscriptionType = oauth.subscriptionType;
    if (oauth.rateLimitTier !== undefined) creds.rateLimitTier = oauth.rateLimitTier;
    return creds;
  } catch {
    return null;
  }
}

export function credBlob(creds: OauthCreds): string {
  const oauth: Record<string, unknown> = {
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    expiresAt: creds.expiresAt,
  };
  if (creds.scopes !== undefined) oauth.scopes = creds.scopes;
  if (creds.subscriptionType !== undefined) oauth.subscriptionType = creds.subscriptionType;
  if (creds.rateLimitTier !== undefined) oauth.rateLimitTier = creds.rateLimitTier;
  return JSON.stringify({ claudeAiOauth: oauth });
}

export async function readCreds(
  configDir: string | null,
): Promise<{ creds: OauthCreds; source: CredSource } | null> {
  const fromKeychain = await keychainRead(keychainService(configDir));
  if (fromKeychain) {
    const creds = parseCredBlob(fromKeychain);
    if (creds) return { creds, source: "keychain" };
  }
  const filePath = credentialsPath(configDir);
  if (existsSync(filePath)) {
    const creds = parseCredBlob(readFileSync(filePath, "utf8"));
    if (creds) return { creds, source: "file" };
  }
  return null;
}

/** Write rotated tokens back to the store they came from; keychain failures
 * fall back to the credentials file. Caveat: after such a fallback the stale
 * keychain entry still wins on the next read (keychain is tried first), so a
 * rotation can appear lost until the keychain becomes writable again. */
export async function writeCreds(
  configDir: string | null,
  creds: OauthCreds,
  source: CredSource,
): Promise<void> {
  const blob = credBlob(creds);
  if (source === "keychain" && (await keychainWrite(keychainService(configDir), blob))) {
    return;
  }
  writeFileAtomic(credentialsPath(configDir), blob, 0o600);
}
