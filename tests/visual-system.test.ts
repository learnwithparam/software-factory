// Structural: the cockpit's design system stays whole. Modelled on machinist
// visual-system.test.js: tokens exist for both themes, the mobile bottom nav
// is in place, and every view goes through the shared heading. Also pins the
// rule that page code never renders server text as HTML.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "..", "dashboard", "public");
const css = readFileSync(join(dir, "styles.css"), "utf8");
const app = readFileSync(join(dir, "app.js"), "utf8");
const TOKENS = ["background", "foreground", "surface", "sidebar", "muted", "muted-foreground", "border", "primary", "primary-foreground", "success", "warning", "danger", "ring"];

function block(startsWith: string): string {
  const start = css.indexOf(startsWith);
  return css.slice(start, css.indexOf("}", start));
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
    expect(css).toContain("grid-template-columns: repeat(5, minmax(0, 1fr))");
    expect(css).toContain("padding-bottom: calc(4.15rem + env(safe-area-inset-bottom))");
  });

  test("motion is reduced on request and focus is always visible", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain(":focus-visible");
  });

  test("the font ships with its licence, and the file the CSS names exists", () => {
    expect(existsSync(join(dir, "fonts", "manrope-latin.woff2"))).toBe(true);
    expect(readFileSync(join(dir, "fonts", "OFL.txt"), "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(css).toContain("/fonts/manrope-latin.woff2");
  });

  test("every top-level view is built with the shared heading", () => {
    for (const view of ["lineView", "inboxView", "runsView", "analyticsView"]) {
      const body = app.slice(app.indexOf(`function ${view}`));
      expect(body.slice(0, body.indexOf("\n}\n")), view).toMatch(/heading\("/);
    }
  });

  test("server text never reaches innerHTML, and labels are not all-caps", () => {
    expect(app).not.toMatch(/\.(innerHTML|outerHTML)\b|insertAdjacentHTML/);
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
  });
});
