// The version lives in package.json and in the CI template's pinned runner
// ref; this pins them together so a release cannot bump one and forget the other.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("template-ci FACTORY_RUNNER_REF is v<package.json version>", () => {
  const { version } = JSON.parse(read("package.json")) as { version: string };
  const ref = /FACTORY_RUNNER_REF: (\S+)/.exec(read("template-ci/factory.yml.example"))?.[1];
  expect(ref).toBe(`v${version}`);
});
