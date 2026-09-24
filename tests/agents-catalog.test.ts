// The Agents page shows every preset, marks which are configured and which stages each serves,
// and never claims "verified" for a preset that has no live run.
import { expect, test } from "bun:test";
import { agentCatalog } from "../src/agents/docs";
import { PRESETS } from "../src/agents/presets";
import { FactoryState } from "../src/state";
import { GitHub } from "../src/github";
import { createDashboard } from "../dashboard/server";

test("a configured agent lists the stages it serves, and every other preset is listed as not configured", () => {
  const rows = agentCatalog({ claude: { preset: "claude" }, checker: { preset: "codex" }, mine: { command: ["aider", "--yes"] } }, { default: "claude", verify: "checker" });
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  expect(by.claude!.stages).toEqual(["triage", "plan", "build", "pr"]);
  expect(by.checker!.stages).toEqual(["verify"]);
  expect(by.mine).toMatchObject({ preset: null, binary: "aider", pin: null, verified: false, stages: [] });
  for (const name of Object.keys(PRESETS)) if (name !== "claude" && name !== "codex") expect(by[name]).toMatchObject({ configured: false, stages: [] });
});

test("only a preset flagged verified shows as verified", () => {
  for (const r of agentCatalog({ claude: { preset: "claude" } }, { default: "claude" })) expect(r.verified).toBe(r.preset === "claude");
});

test("GET /api/agents returns the catalog from the configured fleet", async () => {
  const dash = createDashboard(new FactoryState(":memory:"), new GitHub(), "acme/widgets", false, undefined, { agents: { claude: { preset: "claude" } }, stages: { default: "claude" } });
  const res = await dash.handle(new Request("http://localhost:4100/api/agents"), "127.0.0.1");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { agents: { name: string; stages: string[] }[] };
  expect(body.agents.find((a) => a.name === "claude")!.stages).toHaveLength(5);
  expect(body.agents.length).toBe(Object.keys(PRESETS).length);
});
