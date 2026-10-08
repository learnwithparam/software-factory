// A workflow's `on: cron:` triggers. Each poll walks every minute since the
// last one it checked (at most CRON_CATCHUP_MINUTES back, so a laptop waking
// from a week asleep files one issue, not a thousand) and files a
// factory:ready issue for each trigger that matched. A trigger whose last
// issue is still open does not file another: the backlog never piles up.

import { cronMatches } from "../core/cron";
import type { CronTrigger, Workflow } from "../core/workflow";
import type { ScmPort } from "../ports/scm";
import { LABEL } from "../labels";

export const CRON_CATCHUP_MINUTES = 60;
const MINUTE = 60_000;

export interface CronStore {
  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
}

// The hidden line that ties a filed issue to the trigger that filed it.
export function cronMarker(workflow: string, index: number): string {
  return `<!-- factory:cron ${workflow}/${index} -->`;
}

function matchedSince(t: CronTrigger, from: number, to: number): boolean {
  for (let m = from + MINUTE; m <= to; m += MINUTE) if (cronMatches(t.cron, new Date(m), t.tz)) return true;
  return false;
}

// Returns the numbers of the issues it filed.
export async function fireCron(github: ScmPort, store: CronStore, repo: string, workflow: Workflow, now: Date): Promise<number[]> {
  const triggers = workflow.triggers.cron;
  if (triggers.length === 0) return [];
  const key = `cron:last:${repo}:${workflow.name}`;
  const to = Math.floor(now.getTime() / MINUTE) * MINUTE;
  const last = Number(store.getSetting(key));
  // First boot checks only the current minute.
  const from = Number.isFinite(last) && last > 0 ? Math.max(last, to - CRON_CATCHUP_MINUTES * MINUTE) : to - MINUTE;
  if (from >= to) return [];

  const due = triggers.map((t, i) => [t, i] as const).filter(([t]) => matchedSince(t, from, to));
  const filed: number[] = [];
  if (due.length > 0) {
    const open = await github.listOpenIssues(repo);
    for (const [t, i] of due) {
      const marker = cronMarker(workflow.name, i);
      if (open.some((issue) => (issue.body ?? "").includes(marker))) continue;
      const body = `${t.body ? `${t.body}\n\n` : ""}Filed by the \`${workflow.name}\` workflow's schedule \`${t.cron.src}\` (${t.tz}).\n\n${marker}`;
      filed.push(await github.createIssue(repo, t.title, body, [LABEL.ready]));
    }
  }
  store.setSetting(key, String(to));
  return filed;
}
