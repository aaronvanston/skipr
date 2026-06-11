# skipr

Skipr (Skipper) manages multiple accounts across your coding agents: Claude
Code, plus beta support for Codex. If you run more than one
account (a personal Max plan and a work plan, say) you know the dance: hit a
rate limit mid-session, log out, log back in as someone else, lose your
conversation, and never quite know which account has headroom. Skipr turns
that into one dashboard: every account's 5-hour and 7-day usage at a glance,
one keystroke to launch `claude` under any profile, and a session hop that
carries your current conversation to the account that still has room.

```
skipr

› Claude
╭────────────────────────────────────────────────────────────────────────────────────────╮
│ ● work1     user@example.com       │ [Max 20x]                                         │
│   5-hour: █████████░░░░░░░░░░░░░░░ │   39% +20%  · resets in 4h 3m                     │
│   7-day : ████████████████░░░░░░░░ │   65% +13%  · resets in 3d 9h                     │
╰────────────────────────────────────────────────────────────────────────────────────────╯
╭────────────────────────────────────────────────────────────────────────────────────────╮
│ ○ work2     work@example.com       │ [Max 5x]                                          │
│   5-hour: ██████████░░░░│░░░░░░░░░ │   43% -16%  · resets in 2h 3m                     │
│   7-day : ██░░░░░░│░░░░░░░░░░░░░░░ │    9% -25%  · resets in 4d 14h                    │
╰────────────────────────────────────────────────────────────────────────────────────────╯
┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐
┆ + Add profile (n)                                                                      ┆
└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘
╭────────────────────────────────────────────────────────────────────────────────────────╮
│ ↑↓ select · ⏎ launch · m move session · n new · e edit · c config · r refresh · q quit │
╰────────────────────────────────────────────────────────────────────────────────────────╯
```

Each bar shows utilization against the window, the `│` tick marks where an
even burn rate would put you right now, and the signed percentage is your
pace: `+25%` means you're consuming faster than the window refills (green
when you're under pace, yellow/red as you run hot).

## Features

- **Usage at a glance**: 5-hour and 7-day rate-limit utilization for every
  account, with reset countdowns, color-coded bars, and a burn-rate pace
  indicator showing whether you're over or under an even spend of the window.
- **Codex too (beta)**: your `~/.codex` login appears as its own section with
  live plan and usage (fetched the same way the Codex CLI's /status does,
  with local session snapshots as the offline fallback); add more Codex
  accounts the same way as Claude ones (`n`, pick Codex).
- **One-keystroke launch**: each profile is a fully isolated Claude Code
  config dir; launch any of them side by side in different terminals.
- **Session hop**: hit a limit mid-conversation? Copy the session transcript
  into another profile and resume it there with `--resume`.
- **Shared customizations**: `skills`, `agents`, `commands`, `plugins`, and
  `CLAUDE.md` are symlinked into every profile, so one edit propagates
  everywhere.
- **Token auto-refresh**: idle profiles' expired OAuth tokens are refreshed
  automatically, so they stay launchable and their usage stays fetchable
  without re-login.
- **Headless commands**: `skipr list`, `skipr launch`, `skipr sync`, and
  `skipr config` for scripting; no TUI required.

## Requirements

- macOS (credentials live in the macOS Keychain)
- [Bun](https://bun.sh)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and
  logged in at least once
- Optional: [Codex CLI](https://developers.openai.com/codex/cli) for the Codex
  section

## Install

```sh
git clone https://github.com/aaronvanston/skipr && cd skipr
bun install
bun link        # exposes the `skipr` command
```

## Quickstart

```sh
skipr
```

On first run, your existing `~/.claude` login shows up as the **default**
profile - nothing is moved or modified. Press `n` to add another account:
skipr creates an isolated profile directory, drops you into `claude /login`
for that profile, and returns you to the dashboard when you're done.

From then on: arrow to a profile, press `⏎`, and you're running `claude` under
that account.

## Usage

### Dashboard keybinds

| Key | Action |
|-----|--------|
| `↑` / `↓` | select profile |
| `⏎` | launch selected profile (for non-default profiles flagged `needs login`, starts the login flow instead) |
| `m` | move a session from another profile into the selected one, then resume it |
| `n` | new profile (asks for a name, then the agent: Claude Code or Codex) |
| `e` | edit menu for the selected profile: display label, launch command, set as default, delete (delete asks you to type the name; adopted home profiles can't be deleted) |
| `c` | open the config file in `$EDITOR`; the dashboard reloads when you exit the editor |
| `r` | refresh usage |
| `q` | quit |

### Headless commands

```
skipr - multi-account manager for your coding agents (Claude Code today)

usage:
  skipr                            interactive dashboard
  skipr list                       usage summary for all profiles
  skipr launch [name] [-- args]    launch a profile (default profile when no name)
  skipr sync                       repair shared-item symlinks
  skipr default [name]             show or set a provider's default profile
  skipr config                     show config file path and effective config
  skipr config get <key>           read one config value (dot paths ok)
  skipr config set <key> <value>   change a config value (e.g. thresholds.warn 50)
  skipr --version                  print version

profiles are created from the interactive dashboard (press n).
```

`skipr list` fetches fresh usage for every profile and prints a summary:

```
Claude usage
- user@example.com (default) [Max 20x]
  - 5-hour: 78.0% (resets in 2h 41m)
  - 7-day: 62.0% (resets in 3d 4h)
- work@example.com (work) [Max 5x]
  - 5-hour: 9.0% (resets in 4h 12m)
  - 7-day: 17.5% (resets in 5d 9h)
```

`skipr launch work -- --resume` launches the `work` profile; anything after
`--` is appended to its launch command.

`skipr sync` re-creates missing shared-item symlinks across all profiles
(useful after changing `sharedItems`). It never overwrites a real file or
directory with a symlink - conflicts are reported and skipped.

### Default profiles and the system default

Each provider has a default profile (marked `· default` in the dashboard):
it's preselected on open, and bare `skipr launch` runs it. Change it from the
Edit menu (`e` → Set as default) or headlessly with `skipr default <name>`.

To make the default apply to plain `claude` / `codex` outside skipr, source
skipr's env file from your shell rc once:

```sh
echo 'source ~/.skipper/env.sh' >> ~/.zshrc
```

skipr rewrites `~/.skipper/env.sh` whenever a default changes, so every new
shell picks up the chosen profile via `CLAUDE_CONFIG_DIR` / `CODEX_HOME`.
Credentials are never copied between stores - duplicating an OAuth chain
would break on the next refresh-token rotation - so this stays safe and
instantly reversible (`skipr default default` / `skipr default codex`).
Applies to new shells; GUI-launched apps don't read shell rc files.

`skipr config` prints the config file path on the first line, then the
effective config (your file merged over defaults) as JSON. Every key can
also be read and written from the CLI with dot paths:

```
skipr config set emailDisplay hide
skipr config set thresholds.warn 50
skipr config set providers.claude.launchCommand "claude --dangerously-skip-permissions"
skipr config get providers.claude.defaultProfile.label
```

## Configuration

Config lives at `~/.skipper/config.json`. The file - and any individual key -
is optional; missing keys fall back to defaults.

Configuration is provider-centric: providers (Claude Code, Codex) each carry
their own launch command and default-profile overrides, and every profile is
attached to a provider (chosen when you create it).

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `defaultProvider` | `"claude" \| "codex"` | `"claude"` | Which provider's section lists first in the dashboard. |
| `providers.<p>.launchCommand` | `string` | `"claude"` / `"codex"` | Launch command for that provider's profiles when they have no per-profile override. |
| `providers.<p>.defaultProfile.launchCommand` | `string` | unset | Launch-command override for the provider's adopted default profile (`~/.claude` / `~/.codex`, which have no `profile.json`). |
| `providers.<p>.defaultProfile.label` | `string` | unset | Display label for that default profile. |
| `providers.<p>.defaultProfileName` | `string` | unset (the adopted home) | Which profile is the provider's default: dashboard preselect, bare `skipr launch`, and the system default via `~/.skipper/env.sh`. |
| `sharedItems` | `string[]` | `["skills", "agents", "commands", "plugins", "CLAUDE.md"]` | Items symlinked from each Claude profile dir to the real `~/.claude/<item>`. `settings.json` is deliberately not shared by default (permissions/hooks can be identity-specific) but can be added. |
| `thresholds.warn` | `number` | `60` | Usage bars and percentages turn yellow when utilization exceeds this. |
| `thresholds.danger` | `number` | `85` | …and red when utilization exceeds this. |
| `emailDisplay` | `"show" \| "hide"` | `"show"` | Whether account emails render at all - hide them entirely for screenshots, demos, and streaming (partial masks still leak the address shape, so there is no in-between). Asked once on first run; display-only, nothing on disk changes. (Legacy `"mask"` and `anonymizeEmails: true` are read as `"hide"`.) |

Example:

```json
{
  "defaultProvider": "claude",
  "providers": {
    "claude": {
      "launchCommand": "claude --dangerously-skip-permissions",
      "defaultProfile": { "label": "personal" }
    },
    "codex": { "launchCommand": "codex" }
  },
  "sharedItems": ["skills", "agents", "commands", "plugins", "CLAUDE.md"],
  "thresholds": { "warn": 50, "danger": 80 }
}
```

Each non-default profile can override its launch command via `launchCommand`
in its `profile.json` - easiest edited with the `e` keybind in the dashboard.
Profiles can also carry a display `label` (Edit menu → Label) shown in place
of the directory name; the directory itself never changes, so renaming is
always safe for credentials.

On first run skipr asks one setup question (email display) and writes the
full config file; press `c` in the dashboard any time to edit it in `$EDITOR`.
Resolution order: `profile.json` `launchCommand` → the provider's
`launchCommand` → the provider's binary name. Configs written by older
versions (flat `defaultLaunchCommand` / `codexLaunchCommand` /
`defaultProfile` / `codexProfile` keys) migrate automatically.

Set `SKIPPER_HOME` to relocate the data directory away from `~/.skipper`.

## How it works

- **Profiles are config dirs.** A profile is an isolated `CLAUDE_CONFIG_DIR`
  at `~/.skipper/profiles/<name>/`. Launching it spawns the launch command
  with that env var set; no global state is mutated, so profiles run
  side by side.
- **Your real `~/.claude` is the default profile.** It's adopted in place -
  never copied, never modified - launched with no `CLAUDE_CONFIG_DIR`, and
  cannot be deleted from the TUI.
- **Credentials stay where Claude Code puts them.** Claude Code namespaces its
  macOS Keychain entry per config dir; skipr reads that, falling back to the
  profile's `.credentials.json`. Expired tokens are refreshed via Anthropic's
  OAuth endpoint and written back to whichever store they came from.
- **Usage comes from Anthropic's OAuth usage endpoint.** It's unofficial; if
  it changes shape or fails, the affected row degrades to `usage unavailable`
  and everything else keeps working. Results are cached so the dashboard
  renders instantly and updates as fetches land.
- **Session hop is a copy, not a move.** The transcript `.jsonl` is copied
  into the target profile's `projects/` dir (the source keeps its history) and
  the target launches with `--resume <sessionId>`.

## Security notes

- Tokens are never logged and never written anywhere except the Keychain or
  the profile's credentials file.
- Credential files are written with mode `0600`, atomically.
- The usage cache (`~/.skipper/cache/usage.json`) contains only utilization
  percentages and timestamps - no tokens, no message content.
- The usage and token-refresh endpoints are unofficial and may change without
  notice; skipr degrades gracefully rather than breaking launches.

## Limitations

- Codex support is beta: usage is fetched from the same (unofficial) backend
  the Codex CLI's /status uses, falling back to the freshest rate-limit
  snapshot in `$CODEX_HOME/sessions` when offline. Session hopping is
  Claude-only for now.
- macOS only (Keychain-based credential handling).
- Claude Code only, for now. Codex support is planned - the profile model
  already carries an `agent` field, so it slots in without restructuring.
- Launch commands are whitespace-split: no shell quoting or escaping.

## Uninstall

```sh
rm -rf ~/.skipper   # profiles, config, usage cache
bun unlink          # remove the `skipper` / `skipr` commands
```

Your real `~/.claude` is untouched. Logins created for extra profiles can be
revoked from your Claude account's authorized-apps page.
