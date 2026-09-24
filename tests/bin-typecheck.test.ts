// bin/factory has no .ts extension, so tsc skips it; a copy here is checked
// so a scope or type slip in the dispatcher fails `make check`, not a live run.
import { expect, test } from "bun:test";
import { copyFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

test("bin/factory type-checks", async () => {
  const root = resolve(import.meta.dir, "..");
  const copy = `${root}/bin/zz-typecheck-copy.ts`;
  copyFileSync(`${root}/bin/factory`, copy);
  try {
    const proc = Bun.spawn(["bun", "x", "tsc", "--noEmit"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    expect(out).toBe("");
    expect(await proc.exited).toBe(0);
  } finally {
    rmSync(copy, { force: true });
  }
}, 120_000);
