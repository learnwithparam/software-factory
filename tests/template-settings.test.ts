// The README claims the agent cannot read the runner's credentials; the
// template's deny rules are what make that true.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const settings = JSON.parse(readFileSync(join(import.meta.dir, "..", "template", ".claude", "settings.json"), "utf8"));

test("template denies reading gh and ssh credentials, and pushing", () => {
  for (const rule of ["Read(~/.config/gh/**)", "Read(~/.ssh/**)", "Bash(gh *)", "Bash(git push*)"]) {
    expect(settings.permissions.deny).toContain(rule);
  }
});
