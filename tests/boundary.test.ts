// Defense in depth behind guard-paths.sh (audit finding #12): that hook only
// sees Edit/Write tool calls, so `Bash("sed -i ... src/auth/x.ts")` never
// trips it. This is the independent check the runner makes before any push,
// by diffing the branch against its base rather than trusting how a file
// changed.

import { describe, expect, test } from "bun:test";
import { ALWAYS_PROTECTED_PATHS, touchesProtectedPath } from "../src/boundary";

describe("touchesProtectedPath", () => {
  test("flags an exact-path match", () => {
    expect(touchesProtectedPath(["src/auth/session.ts"], ["src/auth/session.ts"])).toEqual(["src/auth/session.ts"]);
  });

  test("flags a file under a glob, matching what a Bash-made edit would still hit", () => {
    const changed = ["src/auth/tokens.ts", "src/ui/button.tsx"];
    expect(touchesProtectedPath(changed, ["src/auth/**"])).toEqual(["src/auth/tokens.ts"]);
  });

  test("returns no hits when nothing changed touches a protected path", () => {
    expect(touchesProtectedPath(["src/ui/button.tsx", "README.md"], ["src/auth/**", ".env*"])).toEqual([]);
  });

  test("returns no hits when protectedPaths is empty", () => {
    expect(touchesProtectedPath(["anything.ts"], [])).toEqual([]);
  });

  test("collects every offending file, not just the first", () => {
    const changed = ["src/auth/a.ts", "src/ui/b.ts", "src/auth/c.ts"];
    expect(touchesProtectedPath(changed, ["src/auth/**"])).toEqual(["src/auth/a.ts", "src/auth/c.ts"]);
  });

  test("matches a dotfile pattern like a secrets file", () => {
    expect(touchesProtectedPath([".env.production"], [".env*"])).toEqual([".env.production"]);
  });

  // A normal build merges ALWAYS_PROTECTED_PATHS into its call (src/watch.ts),
  // so .claude/** and .factory/** are refused even with the default empty
  // protectedPaths config, matching what guard-paths.sh already hardcodes.
  test("ALWAYS_PROTECTED_PATHS flags .claude/** and .factory/** with no repo config at all", () => {
    const changed = [".claude/skills/factory-build/SKILL.md", ".factory/memory/lessons.md", "src/ui/button.tsx"];
    expect(touchesProtectedPath(changed, [...ALWAYS_PROTECTED_PATHS])).toEqual([
      ".claude/skills/factory-build/SKILL.md",
      ".factory/memory/lessons.md",
    ]);
  });
});
