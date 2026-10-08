// Where a repo's workflow comes from: `.factory/workflows/<name>.yml` in its
// clone, else the copy this runner ships in template/. Parsed and checked
// against the step types the engine has, so a bad file fails at load.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWorkflow, type Workflow, type WorkflowResult } from "../core/workflow";
import { STEP_TYPES } from "./steps";

export const DEFAULT_WORKFLOW = "feature-to-pr";
// What an edge's `if:` may read besides the step ids.
export const EXPR_ROOTS = ["toggles", "config"] as const;

const BUNDLED_DIR = join(import.meta.dir, "..", "..", "template", ".factory", "workflows");

export function parseWorkflowText(text: string): WorkflowResult {
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(text);
  } catch (e) {
    return { ok: false, problems: [`not valid YAML: ${(e as Error).message}`] };
  }
  return parseWorkflow(raw, STEP_TYPES, EXPR_ROOTS);
}

let bundled: Workflow | undefined;

// The pipeline the factory has always run, from the template it ships.
export function defaultWorkflow(): Workflow {
  if (bundled) return bundled;
  const parsed = parseWorkflowText(readFileSync(join(BUNDLED_DIR, `${DEFAULT_WORKFLOW}.yml`), "utf8"));
  if (!parsed.ok) throw new Error(`the bundled ${DEFAULT_WORKFLOW} workflow is invalid: ${parsed.problems.join("; ")}`);
  bundled = parsed.workflow;
  return bundled;
}

// The repo's own file wins over the bundled one of the same name; a missing
// file falls back to it, and a broken one is an error, never a silent default.
export async function loadWorkflow(cloneDir: string, name: string = DEFAULT_WORKFLOW): Promise<WorkflowResult> {
  if (!/^[\w-]+$/.test(name)) return { ok: false, problems: [`workflow "${name}": letters, digits, - and _ only`] };
  for (const dir of [join(cloneDir, ".factory", "workflows"), BUNDLED_DIR]) {
    const file = Bun.file(join(dir, `${name}.yml`));
    if (await file.exists()) return parseWorkflowText(await file.text());
  }
  return { ok: false, problems: [`workflow "${name}": no .factory/workflows/${name}.yml in the repo or the runner`] };
}
