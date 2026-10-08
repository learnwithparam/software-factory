// Walks a workflow from one step until the issue stops: a step parks or
// finishes it, or a park edge hands it to a human. Called for a fresh
// factory:ready pickup, a resume or a retry; `ctx` carries the round counts
// deriveIssueState recovered, so a resumed run doesn't reset the caps.

import type { FactoryConfig } from "../config";
import { OPERATOR_TAKEOVER } from "../executor";
import { evalExpr } from "../core/expr";
import type { Edge, Step, Workflow } from "../core/workflow";
import { latestDataFor, parseDataMarkers } from "../derive";
import type { GhIssue } from "../github";
import { LABEL } from "../labels";
import { McpError } from "../mcp";
import { checkSpendCap, finish, moveLabel, OperatorTakeover, postComment, stopStep, type Outcome, type RunCtx, type WatchDeps } from "./common";
import { RuntimeMissing, STEP_TYPES } from "./steps";

export async function runWorkflow(
  deps: WatchDeps,
  config: FactoryConfig,
  workflow: Workflow,
  issue: GhIssue,
  startStep: string,
  worktree: string,
  ctx: RunCtx = { rejectRound: 0, questionRound: 0 },
): Promise<Outcome> {
  const first = workflow.steps[startStep];
  if (!first) throw new Error(`workflow ${workflow.name} has no step "${startStep}"`);
  let step: Step = first;
  const issueNumber = issue.number;
  // What `if:` reads: each step's JSON, seeded from the thread so a resumed run sees earlier steps.
  const markers = parseDataMarkers(issue.comments);
  const facts: Record<string, unknown> = {};
  for (const id of Object.keys(workflow.steps)) {
    const seen = latestDataFor(markers, id);
    if (seen !== undefined) facts[id] = seen;
  }

  try {
    for (;;) {
      const overBudget = checkSpendCap(deps, config, issueNumber);
      if (overBudget) {
        await postComment(deps, config, issueNumber, `Parked: ${overBudget}.`, { stage: "budget", json: { reason: overBudget } });
        return await stopStep(deps, config, issueNumber, step.label, { status: "needs-human", reason: overBudget });
      }
      const result = await STEP_TYPES[step.uses]!.run({ deps, config, issue, worktree, ctx, step, workflow });
      if (result.kind === "stop") return result.outcome;
      if (result.kind === "reject") {
        const back: Step = workflow.steps[step.reject!]!;
        await moveLabel(deps, config, issueNumber, step.label, back.label);
        step = back;
        continue;
      }
      if (result.facts !== undefined) facts[step.id] = result.facts;
      const edge = pickEdge(step.next, {
        ...facts,
        toggles: { autoApproveLowRisk: deps.state.getToggle("auto_approve_low_risk", config.riskPolicy.autoApproveLowRisk) },
        config,
      });
      if ("park" in edge) {
        await moveLabel(deps, config, issueNumber, step.label, LABEL.awaitingApproval);
        finish(deps, config, issueNumber, "awaiting-approval");
        return "awaiting-approval";
      }
      const to: Step = workflow.steps[edge.to]!;
      await moveLabel(deps, config, issueNumber, step.label, to.label);
      step = to;
    }
  } catch (e) {
    if (e instanceof McpError) {
      // A server the step names is not in the base branch's .factory/mcp.json: nothing ran, so a retry after the fix is free.
      await postComment(deps, config, issueNumber, `Stopped before ${step.id}: ${e.message}. Add it to .factory/mcp.json or drop it from the step, then \`/factory retry\`.`, { stage: "mcp", json: { step: step.id, problem: e.message } });
      return await stopStep(deps, config, issueNumber, step.label, { status: "failed", reason: e.message });
    }
    if (e instanceof RuntimeMissing) {
      await postComment(deps, config, issueNumber, `Stopped before ${step.id}: ${e.message}. Add it to FACTORY_HOME/machine.json runtimes or drop it from the step, then \`/factory retry\`.`, { stage: "runtime", json: { step: step.id, problem: e.message } });
      return await stopStep(deps, config, issueNumber, step.label, { status: "failed", reason: e.message });
    }
    if (!(e instanceof OperatorTakeover)) throw e;
    // Not a failure and not a retry: the operator owns the session now, and
    // `/factory retry` (or `factory takeover`'s hand-back) re-enters this step.
    await moveLabel(deps, config, issueNumber, step.label, LABEL.needsHuman);
    await postComment(
      deps,
      config,
      issueNumber,
      `Taken over by an operator during ${step.id}. Comment \`/factory retry\` to hand it back; the factory resumes at ${step.id} with whatever is in the worktree.`,
      { stage: "takeover", json: { stage: step.id } },
    );
    finish(deps, config, issueNumber, "needs-human", OPERATOR_TAKEOVER);
    return "needs-human";
  }
}

// The first edge whose `if:` holds; parseWorkflow guarantees the last has none.
function pickEdge(edges: readonly Edge[], scope: Readonly<Record<string, unknown>>): Edge {
  return edges.find((e) => !e.if || Boolean(evalExpr(e.if, scope)))!;
}

// The park edge of the step an issue awaiting approval parked on, for /factory approve and revise.
export function parkEdgeOf(workflow: Workflow, stepId: string): Extract<Edge, { park: string }> | undefined {
  return workflow.steps[stepId]?.next.find((e): e is Extract<Edge, { park: string }> => "park" in e);
}
