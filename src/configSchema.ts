/** Declarative schema for every config key: drives `skipr config set`
 * validation, `skipr config keys` discoverability, and doctor's issue scan.
 * Paths use `*` for one wildcard segment. */
export interface FieldSpec {
  path: string;
  type: "string" | "number" | "boolean" | "string[]";
  enum?: string[];
  description: string;
}

export const CONFIG_SCHEMA: FieldSpec[] = [
  { path: "defaultProvider", type: "string", enum: ["claude", "codex"], description: "provider listed first and preselected in the dashboard" },
  { path: "emailDisplay", type: "string", enum: ["show", "hide"], description: "whether account emails render at all" },
  { path: "thresholds.warn", type: "number", description: "usage turns yellow above this percent" },
  { path: "thresholds.danger", type: "number", description: "usage turns red above this percent" },
  { path: "providers.*.launchCommand", type: "string", description: "launch command for the provider's profiles" },
  { path: "providers.*.sharedItems", type: "string[]", description: "items symlinked from the provider's home into its profiles" },
  { path: "providers.*.defaultProfileName", type: "string", description: "the provider's default profile (preselect, bare launch, env.sh)" },
  { path: "providers.*.defaultProfile.label", type: "string", description: "display label for the provider's adopted default profile" },
  { path: "providers.*.defaultProfile.launchCommand", type: "string", description: "launch-command override for the adopted default profile" },
  { path: "profiles.*.label", type: "string", description: "display label for a named profile" },
  { path: "profiles.*.launchCommand", type: "string", description: "launch-command override for a named profile" },
  { path: "profiles.*.hidden", type: "boolean", description: "hide a named profile from the dashboard without deleting it" },
];

function pathMatches(specPath: string, path: string): boolean {
  const specParts = specPath.split(".");
  const parts = path.split(".");
  if (specParts.length !== parts.length) return false;
  return specParts.every((seg, i) => seg === "*" || seg === parts[i]);
}

export function resolveSpec(path: string): FieldSpec | undefined {
  return CONFIG_SCHEMA.find((spec) => pathMatches(spec.path, path));
}

/** All schema paths that PREFIX-match, for "did you mean a deeper key" errors
 * (e.g. `config set thresholds 5` should point at thresholds.warn/danger). */
export function specsUnder(path: string): FieldSpec[] {
  return CONFIG_SCHEMA.filter((spec) => {
    const specParts = spec.path.split(".");
    const parts = path.split(".");
    if (parts.length >= specParts.length) return false;
    return parts.every((seg, i) => specParts[i] === "*" || specParts[i] === seg);
  });
}

export function validateValue(spec: FieldSpec, value: unknown): string | null {
  switch (spec.type) {
    case "string":
      if (typeof value !== "string") return `expected a string`;
      if (spec.enum && !spec.enum.includes(value)) return `expected one of: ${spec.enum.join(", ")}`;
      return null;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : `expected a number`;
    case "boolean":
      return typeof value === "boolean" ? null : `expected true or false`;
    case "string[]":
      return Array.isArray(value) && value.every((v) => typeof v === "string")
        ? null
        : `expected an array of strings`;
  }
}

/** Walk a raw parsed config and report unknown keys and type mismatches.
 * Non-fatal: loadConfig still normalizes; doctor surfaces these. */
export function collectConfigIssues(raw: unknown): string[] {
  const issues: string[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const spec = resolveSpec(path);
      if (spec) {
        const problem = validateValue(spec, value);
        if (problem) issues.push(`${path}: ${problem}`);
        continue;
      }
      if (specsUnder(path).length > 0) {
        walk(value, path);
        continue;
      }
      issues.push(`${path}: unknown key`);
    }
  };
  walk(raw, "");
  return issues;
}
