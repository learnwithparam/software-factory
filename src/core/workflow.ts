// A workflow: named steps, each a built-in step type (`uses:`) with the label
// it holds while it runs and where it goes next. The engine walks it; this
// file only parses and checks it, so a bad workflow fails at boot with every
// problem named. Pure: no I/O, no adapter.

import { parseExpr, rootsOf, ExprError, type Expr } from "./expr";

export type ParkState = "awaiting-approval";

export type Edge =
  | { readonly if?: Expr; readonly ifSrc?: string; readonly to: string }
  | { readonly if?: Expr; readonly ifSrc?: string; readonly park: ParkState; readonly approve: string; readonly revise: string };

export interface Step {
  readonly id: string;
  readonly uses: string;
  readonly label: string;
  readonly next: readonly Edge[];
  // Where a rejection sends the issue back to; counted against limits.rejects.
  readonly reject?: string;
  // Where `/factory revise` sends an issue parked on this step's label.
  readonly revise?: string;
  // A `check` step's shell command.
  readonly run?: string;
}

export interface Workflow {
  readonly name: string;
  readonly limits: { readonly questions: number; readonly rejects: number };
  readonly start: string;
  readonly steps: Readonly<Record<string, Step>>;
}

// What the engine says about each step type it implements.
export interface StepKind {
  // Ends the workflow itself (opens the PR), so it has no `next:`.
  readonly terminal?: boolean;
  // Can come back as a rejection, so it must say where that goes.
  readonly rejects?: boolean;
  // Needs a `run:` command.
  readonly command?: boolean;
}

const STEP_KEYS = new Set(["uses", "label", "next", "reject", "revise", "run"]);
const TOP_KEYS = new Set(["name", "description", "limits", "steps"]);
const EDGE_KEYS = new Set(["if", "to", "park", "approve", "revise"]);
const PARKS: readonly ParkState[] = ["awaiting-approval"];

export type WorkflowResult = { ok: true; workflow: Workflow } | { ok: false; problems: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export function parseWorkflow(raw: unknown, kinds: Readonly<Record<string, StepKind>>, exprRoots: readonly string[] = []): WorkflowResult {
  const problems: string[] = [];
  if (!isObj(raw)) return { ok: false, problems: ["a workflow is a mapping with name and steps"] };
  for (const k of Object.keys(raw)) if (!TOP_KEYS.has(k)) problems.push(`${k}: unknown key (allowed: ${[...TOP_KEYS].join(", ")})`);
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name : (problems.push("name: required"), "");

  const limitsRaw = raw.limits === undefined ? {} : raw.limits;
  const limits = { questions: 2, rejects: 2 };
  if (!isObj(limitsRaw)) problems.push("limits: must be a mapping");
  else {
    for (const [k, v] of Object.entries(limitsRaw)) {
      if (k !== "questions" && k !== "rejects") problems.push(`limits.${k}: unknown key (allowed: questions, rejects)`);
      else if (!Number.isInteger(v) || (v as number) < 0) problems.push(`limits.${k}: must be a whole number, 0 or more`);
      else limits[k] = v as number;
    }
  }

  if (!isObj(raw.steps) || Object.keys(raw.steps).length === 0) {
    problems.push("steps: needs at least one step");
    return { ok: false, problems };
  }
  const ids = Object.keys(raw.steps);
  const steps: Record<string, Step> = {};
  const labels = new Map<string, string>();
  const roots = new Set([...ids, ...exprRoots]);

  const parseIf = (where: string, src: unknown): { if?: Expr; ifSrc?: string } => {
    if (src === undefined) return {};
    if (typeof src !== "string") {
      problems.push(`${where}.if: must be a string`);
      return {};
    }
    try {
      const expr = parseExpr(src);
      for (const r of rootsOf(expr)) if (!roots.has(r)) problems.push(`${where}.if: "${r}" is not a step or one of ${[...exprRoots].join(", ")}`);
      return { if: expr, ifSrc: src };
    } catch (e) {
      problems.push(`${where}.if: ${e instanceof ExprError ? e.message : String(e)}`);
      return {};
    }
  };

  for (const id of ids) {
    const where = `steps.${id}`;
    const s = raw.steps[id];
    if (!isObj(s)) {
      problems.push(`${where}: must be a mapping`);
      continue;
    }
    for (const k of Object.keys(s)) if (!STEP_KEYS.has(k)) problems.push(`${where}.${k}: unknown key (allowed: ${[...STEP_KEYS].join(", ")})`);
    const uses = typeof s.uses === "string" ? s.uses : "";
    const kind = kinds[uses];
    if (!kind) problems.push(`${where}.uses: ${uses ? `"${uses}" is not a step type` : "required"} (known: ${Object.keys(kinds).join(", ")})`);
    const label = typeof s.label === "string" && s.label.trim() ? s.label : (problems.push(`${where}.label: required`), "");
    if (label && labels.has(label)) problems.push(`${where}.label: "${label}" is already ${labels.get(label)}'s label`);
    else if (label) labels.set(label, id);

    const edges: Edge[] = [];
    const nextRaw = typeof s.next === "string" ? [{ to: s.next }] : s.next;
    if (nextRaw !== undefined && !Array.isArray(nextRaw)) problems.push(`${where}.next: a step id or a list of edges`);
    for (const [i, e] of (Array.isArray(nextRaw) ? nextRaw : []).entries()) {
      const ew = `${where}.next[${i}]`;
      if (!isObj(e)) {
        problems.push(`${ew}: must be a mapping`);
        continue;
      }
      for (const k of Object.keys(e)) if (!EDGE_KEYS.has(k)) problems.push(`${ew}.${k}: unknown key (allowed: ${[...EDGE_KEYS].join(", ")})`);
      const cond = parseIf(ew, e.if);
      if (typeof e.to === "string" && e.park === undefined) edges.push({ ...cond, to: e.to });
      else if (typeof e.park === "string" && e.to === undefined) {
        if (!PARKS.includes(e.park as ParkState)) problems.push(`${ew}.park: "${e.park}" is not one of ${PARKS.join(", ")}`);
        if (typeof e.approve !== "string") problems.push(`${ew}.approve: required with park (the step /factory approve resumes)`);
        if (typeof e.revise !== "string") problems.push(`${ew}.revise: required with park (the step /factory revise resumes)`);
        edges.push({ ...cond, park: e.park as ParkState, approve: String(e.approve ?? ""), revise: String(e.revise ?? "") });
      } else problems.push(`${ew}: needs exactly one of to or park`);
    }
    edges.forEach((e, i) => {
      if (!e.if && i < edges.length - 1) problems.push(`${where}.next[${i}]: has no if:, so the edges after it never run`);
    });
    if (edges.length > 0 && edges.at(-1)!.if) problems.push(`${where}.next: the last edge needs no if:, so some edge always applies`);
    if (kind?.terminal && edges.length > 0) problems.push(`${where}.next: a ${uses} step ends the workflow, so it has no next`);
    if (kind && !kind.terminal && edges.length === 0) problems.push(`${where}.next: required (only a terminal step type ends the workflow)`);
    if (kind?.rejects && typeof s.reject !== "string") problems.push(`${where}.reject: required, a ${uses} step can reject`);
    if (s.reject !== undefined && !kind?.rejects) problems.push(`${where}.reject: a ${uses} step never rejects`);
    if (kind?.command && (typeof s.run !== "string" || !s.run.trim())) problems.push(`${where}.run: required, the command a ${uses} step runs`);
    if (s.run !== undefined && kind && !kind.command) problems.push(`${where}.run: a ${uses} step takes no command`);

    steps[id] = {
      id,
      uses,
      label,
      next: edges,
      ...(typeof s.reject === "string" ? { reject: s.reject } : {}),
      ...(typeof s.revise === "string" ? { revise: s.revise } : {}),
      ...(typeof s.run === "string" ? { run: s.run } : {}),
    };
  }

  for (const step of Object.values(steps)) {
    for (const [what, target] of targets(step)) if (!steps[target]) problems.push(`steps.${step.id}.${what}: no step "${target}"`);
  }
  if (problems.length === 0) {
    const cycle = forwardCycle(steps);
    if (cycle) problems.push(`steps: ${cycle.join(" -> ")} loops through next:; only reject, revise and approve may point back`);
    const reached = reachable(steps, ids[0]!);
    for (const id of ids) if (!reached.has(id)) problems.push(`steps.${id}: no edge reaches it from ${ids[0]}`);
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, workflow: { name, limits, start: ids[0]!, steps } };
}

// Every step id a step can hand the issue to, with the key that names it.
export function targets(step: Step): [string, string][] {
  const out: [string, string][] = [];
  step.next.forEach((e, i) => {
    if ("to" in e) out.push([`next[${i}].to`, e.to]);
    else out.push([`next[${i}].approve`, e.approve], [`next[${i}].revise`, e.revise]);
  });
  if (step.reject) out.push(["reject", step.reject]);
  if (step.revise) out.push(["revise", step.revise]);
  return out;
}

function forwardCycle(steps: Readonly<Record<string, Step>>): string[] | undefined {
  const state = new Map<string, "open" | "done">();
  const path: string[] = [];
  const visit = (id: string): string[] | undefined => {
    if (state.get(id) === "done") return undefined;
    if (state.get(id) === "open") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "open");
    path.push(id);
    for (const e of steps[id]!.next) {
      if (!("to" in e)) continue;
      const found = visit(e.to);
      if (found) return found;
    }
    path.pop();
    state.set(id, "done");
    return undefined;
  };
  for (const id of Object.keys(steps)) {
    const found = visit(id);
    if (found) return found;
  }
  return undefined;
}

function reachable(steps: Readonly<Record<string, Step>>, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) for (const [, t] of targets(steps[queue.shift()!]!)) if (!seen.has(t)) seen.add(t), queue.push(t);
  return seen;
}

// The step holding `label`, if any: how a resumed issue finds where it is.
export function stepByLabel(workflow: Workflow, label: string): Step | undefined {
  return Object.values(workflow.steps).find((s) => s.label === label);
}
