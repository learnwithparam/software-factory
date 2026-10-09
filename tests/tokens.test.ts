// Structural: the cockpit's colour is asserted, not eyeballed. Every pair a
// theme renders reaches its WCAG level, every role is in a pair, tokens.css is
// what the generator would write now, no other file in dashboard/public holds a
// colour literal, and every var(--x) the page uses is defined.

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { COLOR_LITERAL, DECORATIVE, LEVELS, THEMES, THEME_PAIRS, TOKENS_CSS, loadTokens, ratio, renderCss, resolveTheme } from "../dashboard/tokens";

const tokens = loadTokens();
const PUBLIC = join(import.meta.dir, "..", "dashboard", "public");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

describe("design tokens", () => {
  for (const name of Object.keys(THEMES) as Array<keyof typeof THEMES>) {
    test(`${name}: every pair reaches its level, and every role is in a pair`, () => {
      const theme = resolveTheme(tokens, name);
      const low = THEME_PAIRS[name]
        .filter(([fg, bg, level]) => ratio(theme[fg]!, theme[bg]!) < LEVELS[level])
        .map(([fg, bg, level]) => `${fg} on ${bg} is ${ratio(theme[fg]!, theme[bg]!).toFixed(2)}:1, needs ${level}`);
      expect(low).toEqual([]);
      const paired = new Set(THEME_PAIRS[name].flatMap(([fg, bg]) => [fg, bg]));
      expect(Object.keys(THEMES[name]).filter((r) => !DECORATIVE.includes(r) && !paired.has(r))).toEqual([]);
    });
  }

  test("tokens.json's own contrast table holds", () => {
    const low = tokens.contrast.pairs.filter((p) => ratio(tokens.color[p.fg]!.value, tokens.color[p.bg]!.value) < LEVELS[p.level]);
    expect(low).toEqual([]);
  });

  test("tokens.css is generated and current (make tokens)", () => {
    expect(readFileSync(TOKENS_CSS, "utf8")).toBe(renderCss(tokens));
  });

  test("no colour literal outside tokens.css", () => {
    const hits = walk(PUBLIC)
      .filter((f) => f !== TOKENS_CSS && /\.(css|js|html)$/.test(f))
      .flatMap((f) => readFileSync(f, "utf8").split("\n").flatMap((line, i) => (COLOR_LITERAL.test(line) ? [`${relative(PUBLIC, f)}:${i + 1}: ${line.trim()}`] : [])));
    expect(hits).toEqual([]);
  });

  test("every var(--x) the page uses is a defined token", () => {
    const defined = new Set([...readFileSync(TOKENS_CSS, "utf8").matchAll(/--([\w-]+):/g)].map((m) => m[1]));
    const used = walk(PUBLIC)
      .filter((f) => /\.(css|js)$/.test(f))
      .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/var\(--([\w-]+)/g)].map((m) => `${relative(PUBLIC, f)}: --${m[1]}`).filter((u) => !defined.has(u.split("--").pop())));
    expect(used).toEqual([]);
  });
});
