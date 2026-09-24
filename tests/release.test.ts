// The version lives in package.json and in the CI template's pinned runner
// ref; this pins them together so a release cannot bump one and forget the other.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LABEL } from "../src/labels";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("template-ci FACTORY_RUNNER_REF is v<package.json version>", () => {
  const { version } = JSON.parse(read("package.json")) as { version: string };
  const ref = /FACTORY_RUNNER_REF: (\S+)/.exec(read("template-ci/factory.yml.example"))?.[1];
  expect(ref).toBe(`v${version}`);
});

test("the Dockerfile and the CI template pin the same Claude Code version", () => {
  const docker = /ARG CLAUDE_CODE_VERSION=(\S+)/.exec(read("Dockerfile"))?.[1];
  const ci = /CLAUDE_CODE_VERSION: "([^"]+)"/.exec(read("template-ci/factory.yml.example"))?.[1];
  expect(docker).toMatch(/^\d+\.\d+\.\d+$/);
  expect(ci).toBe(docker);
});

test("the README describes only what exists: every label is listed and no monitor stage is claimed", () => {
  const readme = read("README.md");
  for (const label of Object.values(LABEL)) expect(readme).toContain(`\`${label}\``);
  expect(readme).not.toMatch(/verify, PR, monitor/);
  expect(readme).not.toMatch(/the monitor closes/);
});

test("the README names every agent preset and the config keys that choose one", async () => {
  const { PRESETS } = await import("../src/agents/presets");
  const readme = read("README.md");
  for (const name of Object.keys(PRESETS)) expect(readme).toContain(`"preset": "${name}"`);
  for (const word of ['"agents"', '"stages"', "{{promptFile}}", "FACTORY_ARTIFACT_DIR"]) expect(readme).toContain(word);
});
