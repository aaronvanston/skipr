import { describe, expect, test } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { UsageBar } from "../tui/UsageBar";
import { ProfileRow } from "../tui/ProfileRow";
import { SessionPicker } from "../tui/SessionPicker";
import { StatusFooter } from "../tui/StatusFooter";
import type { Profile, UsageSnapshot, SessionInfo } from "../types";

const profile: Profile = { name: "work", configDir: "/p/w", meta: { agent: "claude", createdAt: "" } };

describe("UsageBar", () => {
  test("renders filled and empty cells at width 24", () => {
    const { lastFrame } = render(<UsageBar utilization={92} />);
    expect(lastFrame()).toContain("█".repeat(22) + "░░");
  });
  test("renders the pace tick in the empty track", () => {
    const { lastFrame } = render(<UsageBar utilization={30} expected={60} width={10} />);
    expect(lastFrame()).toContain("███░░░│░░░");
  });
  test("hides the tick once usage has passed it", () => {
    const { lastFrame } = render(<UsageBar utilization={80} expected={40} width={10} />);
    expect(lastFrame()).toContain("████████░░");
    expect(lastFrame()).not.toContain("│");
  });
});

describe("ProfileRow", () => {
  test("shows marker, email, tier, and usage windows", () => {
    const usage: UsageSnapshot = {
      fetchedAt: 0,
      windows: {
        five_hour: { utilization: 92, resetsAt: new Date(Date.now() + 4 * 3600_000 + 30_000).toISOString() },
        seven_day: { utilization: 71, resetsAt: new Date(Date.now() + 53 * 3600_000 + 30_000).toISOString() },
      },
    };
    const { lastFrame } = render(
      <ProfileRow
        profile={profile}
        identity={{ email: "a@b.com", tier: "default_claude_max_20x" }}
        usage={usage}
        loading={false}
        selected={true}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("● work");
    expect(frame).toContain("a@b.com");
    expect(frame).toContain("[Max 20x]");
    expect(frame).toContain("5-hour");
    expect(frame).toContain("92%");
    expect(frame).toContain("+72%"); // pace: ~20% of the 5h window elapsed, 92% used
    expect(frame).toContain("+3%");  // pace: ~68% of the 7d window elapsed, 71% used
    expect(frame).toContain("7-day");
    expect(frame).toContain("resets in");
  });

  test("shows needs-login and unavailable states", () => {
    const login = render(
      <ProfileRow profile={profile} identity={{ email: null, tier: null }}
        usage={{ fetchedAt: 0, windows: {}, error: "needs login" }} loading={false} selected={false} />,
    );
    expect(login.lastFrame()).toContain("needs login");
    const unavailable = render(
      <ProfileRow profile={profile} identity={{ email: "a@b.com", tier: null }}
        usage={{ fetchedAt: 0, windows: {}, error: "usage unavailable" }} loading={false} selected={false} />,
    );
    expect(unavailable.lastFrame()).toContain("usage unavailable");
  });
});

describe("SessionPicker", () => {
  test("lists sessions with profile, age source, and snippet", () => {
    const sessions: SessionInfo[] = [
      // 30s past the hour so the growing age delta stays inside "1h 0m"/"2h 0m"
      { id: "s1", profileName: "default", path: "/x", mtimeMs: Date.now() - 3600_000 - 30_000, snippet: "fix login bug" },
      { id: "s2", profileName: "personal", path: "/y", mtimeMs: Date.now() - 7200_000 - 30_000, snippet: "write tests" },
    ];
    const { lastFrame } = render(<SessionPicker sessions={sessions} selected={0} />);
    const frame = lastFrame()!;
    expect(frame).toContain("fix login bug");
    expect(frame).toContain("default");
    expect(frame).toContain("personal");
    expect(frame).toContain("❯");
    expect(frame).toContain("1h 0m ago");
    expect(frame).toContain("2h 0m ago");
  });
});

describe("StatusFooter", () => {
  test("lists keybinds", () => {
    const { lastFrame } = render(<StatusFooter />);
    const frame = lastFrame()!;
    for (const hint of ["launch", "move session", "new", "refresh", "quit"]) {
      expect(frame).toContain(hint);
    }
  });
});

describe("ProfileRow label + emailDisplay", () => {
  test("shows the label instead of the name", () => {
    const labeled = { ...profile, meta: { ...profile.meta, label: "Work - Acme" } };
    const { lastFrame } = render(
      <ProfileRow profile={labeled} identity={{ email: "alice@example.com", tier: null }}
        usage={undefined} loading={false} selected={false} emailDisplay="show" />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("Work - Acme");
    expect(frame).toContain("alice@example.com");
  });

  test("hide drops the email entirely", () => {
    const { lastFrame } = render(
      <ProfileRow profile={profile} identity={{ email: "alice@example.com", tier: "default_claude_max_5x" }}
        usage={undefined} loading={false} selected={false} emailDisplay="hide" />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain("alice");
    expect(frame).toContain("[Max 5x]"); // tier still aligned and visible
  });
});
