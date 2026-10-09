// Structural: the cockpit's design system stays whole. Modelled on machinist
// visual-system.test.js: tokens exist for both themes (their contrast is
// tests/tokens.test.ts), the mobile bottom nav
// is in place, and every view goes through the shared heading. Also pins the
// rule that page code never renders server text as HTML.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..", "dashboard", "public");
const css = readFileSync(join(dir, "styles.css"), "utf8");
const tokensCss = readFileSync(join(dir, "tokens.css"), "utf8");
const app = readFileSync(join(dir, "app.js"), "utf8");
const TOKENS = ["bg", "fg", "surface", "sidebar", "muted", "line", "track", "accent", "accent-text", "on-accent", "tone-pass", "tone-wait", "tone-fail"];

function block(startsWith: string): string {
  const start = tokensCss.indexOf(startsWith);
  return tokensCss.slice(start, tokensCss.indexOf("}", start));
}

describe("visual system", () => {
  test("every colour token is defined for light, dark, and the system-dark preference", () => {
    const light = block(":root {");
    const dark = block(':root[data-theme="dark"] {');
    const system = block(':root:not([data-theme="light"]) {');
    for (const t of TOKENS) {
      for (const [name, b] of [["light", light], ["dark", dark], ["system", system]] as const) expect(b, `${t} in ${name}`).toContain(`--${t}:`);
    }
  });

  test("mobile navigation is a bottom bar with safe-area padding", () => {
    expect(css).toMatch(/\.app-sidebar nav \{ position: fixed;[^}]*bottom: 0;/);
    expect(css).toMatch(/\.app-sidebar nav \{[^}]*grid-auto-flow: column;[^}]*overflow-x: auto;/);
    expect(css).toContain("padding-bottom: calc(4.15rem + env(safe-area-inset-bottom))");
  });

  test("motion is reduced on request and focus is always visible", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain(":focus-visible");
  });

  test("each font ships with its licence, and every file the CSS names exists", () => {
    const named = [...css.matchAll(/url\("\/(fonts\/[\w-]+\.woff2)"\)/g)].map((m) => m[1]!);
    expect(named.length).toBe(4);
    for (const f of named) expect(existsSync(join(dir, f)), f).toBe(true);
    for (const family of ["inter", "inconsolata"]) expect(readFileSync(join(dir, "fonts", `LICENSE-${family}.txt`), "utf8")).toContain("SIL Open Font License, Version 1.1");
  });

  test("every top-level view is built with the shared heading", () => {
    for (const view of ["lineView", "inboxView", "runsView", "workflowsView", "analyticsView", "agentsView", "settingsView"]) {
      const body = app.slice(app.indexOf(`function ${view}`));
      expect(body.slice(0, body.indexOf("\n}\n")), view).toMatch(/heading\("/);
    }
  });

  test("server text never reaches innerHTML, and labels are not all-caps", () => {
    expect(app).not.toMatch(/\.(innerHTML|outerHTML)\b|insertAdjacentHTML/);
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
  });
});
