// Records an agent's raw stdout, scrubbed, so a participant's `factory verify-agent`
// run becomes a replayable fixture (tests/fixtures/agents/<name>/<stage>.jsonl).

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEY_SHAPES = /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,}|Bearer\s+[A-Za-z0-9._-]{16,})/g;
const SECRET_ENV = /(KEY|TOKEN|SECRET|PASSWORD)/i;

// Env values that look like credentials are replaced wherever they appear, then well-known key shapes,
// then absolute paths under the home and worktree directories.
export function scrubLine(line: string, env: NodeJS.ProcessEnv, paths: readonly string[] = [homedir()]): string {
  let out = line;
  for (const [key, value] of Object.entries(env)) {
    if (value && value.length >= 8 && SECRET_ENV.test(key)) out = out.split(value).join("<redacted>");
  }
  out = out.replace(KEY_SHAPES, "<redacted>");
  for (const p of paths) if (p.length > 1) out = out.split(p).join("<path>");
  return out;
}

export class FixtureRecorder {
  constructor(
    private readonly dir: string,
    private readonly agent: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly paths: readonly string[] = [homedir()],
  ) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "fixture.json"), JSON.stringify({ agent, synthetic: false }, null, 2) + "\n");
  }

  line(stage: string, raw: string): void {
    if (!raw.trim()) return;
    appendFileSync(join(this.dir, `${stage}.jsonl`), scrubLine(raw, this.env, this.paths) + "\n");
  }
}
