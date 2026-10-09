// The one resolver for the cockpit's colour. design/tokens.json is the palette
// (a byte copy of lwp-deck's design/tokens.json); THEMES says which palette
// entry plays which role on screen. scripts/build-tokens.ts writes
// public/tokens.css from it, and tests/tokens.test.ts checks every pair and
// that the file on disk is what this would write now.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const TOKENS_JSON = join(import.meta.dir, "design", "tokens.json");
export const TOKENS_CSS = join(import.meta.dir, "public", "tokens.css");

interface Palette {
  readonly color: Readonly<Record<string, { readonly value: string }>>;
  readonly contrast: { readonly pairs: ReadonlyArray<{ fg: string; bg: string; level: Level }> };
  readonly font: { readonly sans: { readonly value: string }; readonly mono: { readonly value: string } };
  readonly radius: { readonly sm: string; readonly md: string };
}

export function loadTokens(): Palette {
  return JSON.parse(readFileSync(TOKENS_JSON, "utf8")) as Palette;
}

// A palette name, or pct% of palette colour `top` over `base`, resolved to a
// hex here so a tinted role is contrast-checked as rendered.
type Source = string | { readonly mix: readonly [string, string, number] };

// Roles the page draws with. `line` and `track` are hairlines and empty bar
// fills with nothing on top, so they are the only roles in no contrast pair.
//   accent      a fill, with on-accent text on it; never text on paper
//   accent-text the yellow-toned mark that has to read on the page
//   tone-*      a state colour as text; tone-*-bg a quiet fill of it
export const DECORATIVE: readonly string[] = ["line", "track"];

export const THEMES: Readonly<Record<"light" | "dark", Readonly<Record<string, Source>>>> = {
  light: {
    bg: "paper",
    surface: "card",
    sidebar: { mix: ["ink", "paper", 5] },
    fg: "ink",
    "fg-2": "ink-2",
    muted: "muted",
    line: "line",
    track: { mix: ["ink", "paper", 8] },
    accent: "accent",
    "accent-text": "accent-deep",
    "on-accent": "ink",
    "tone-pass": "pass",
    "tone-fail": "fail",
    "tone-wait": "wait",
    "tone-pass-bg": { mix: ["pass", "paper", 12] },
    "tone-fail-bg": { mix: ["fail", "paper", 12] },
    "tone-wait-bg": { mix: ["wait", "paper", 12] },
    "code-bg": "fill-dark",
    "code-fg": "paper",
  },
  dark: {
    bg: "ink",
    surface: "fill-dark",
    sidebar: { mix: ["paper", "ink", 3] },
    fg: "paper",
    "fg-2": "line",
    muted: { mix: ["paper", "faint", 25] },
    line: "ink-2",
    track: { mix: ["paper", "ink", 10] },
    accent: "accent",
    "accent-text": "accent",
    "on-accent": "ink",
    "tone-pass": { mix: ["pass", "paper", 55] },
    "tone-fail": { mix: ["fail", "paper", 55] },
    "tone-wait": { mix: ["wait", "paper", 55] },
    "tone-pass-bg": { mix: ["pass", "ink", 30] },
    "tone-fail-bg": { mix: ["fail", "ink", 30] },
    "tone-wait-bg": { mix: ["wait", "ink", 30] },
    "code-bg": "fill-dark",
    "code-fg": "paper",
  },
};

export type Level = "AAA" | "AA" | "AA-large";
export const LEVELS: Readonly<Record<Level, number>> = { AAA: 7, AA: 4.5, "AA-large": 3 };

// Every pair the page renders. The tone colours are small text (a failed
// status, a "needs you" label), so they need AA, not the large-text level;
// the sidebar holds only the nav and the toggles, so no tone sits on it.
const PAIRS: ReadonlyArray<readonly [string, string, Level]> = [
  ...["bg", "surface", "sidebar"].flatMap((bg) => [
    ["fg", bg, "AAA"] as const,
    ["fg-2", bg, "AAA"] as const,
    ["muted", bg, "AA"] as const,
    ["accent-text", bg, "AA"] as const,
  ]),
  ...["bg", "surface"].flatMap((bg) => [
    ["tone-pass", bg, "AA"] as const,
    ["tone-fail", bg, "AA"] as const,
    ["tone-wait", bg, "AA"] as const,
  ]),
  ["on-accent", "accent", "AAA"],
  ["bg", "accent-text", "AA-large"],
  ["fg", "tone-pass-bg", "AAA"],
  ["fg", "tone-fail-bg", "AAA"],
  ["fg", "tone-wait-bg", "AAA"],
  ["code-fg", "code-bg", "AAA"],
];
export const THEME_PAIRS: Readonly<Record<keyof typeof THEMES, typeof PAIRS>> = { light: PAIRS, dark: PAIRS };

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function mixHex(top: string, base: string, pct: number): string {
  const a = parseInt(top.slice(1), 16);
  const b = parseInt(base.slice(1), 16);
  const ch = (shift: number) => Math.round((((a >> shift) & 255) * pct + ((b >> shift) & 255) * (100 - pct)) / 100);
  return `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export function resolveTheme(tokens: Palette, name: keyof typeof THEMES): Record<string, string> {
  const hex = (role: string, palette: string) => {
    const entry = tokens.color[palette];
    if (!entry) throw new Error(`theme ${name}: role "${role}" names "${palette}", which is not in tokens.json`);
    return entry.value;
  };
  return Object.fromEntries(
    Object.entries(THEMES[name]).map(([role, s]) => [role, typeof s === "string" ? hex(role, s) : mixHex(hex(role, s.mix[0]), hex(role, s.mix[1]), s.mix[2])]),
  );
}

// Light is the default; dark applies when chosen, or when the system prefers
// it and nothing was chosen. The theme toggle sets data-theme.
export function renderCss(tokens: Palette): string {
  const vars = (scheme: string, theme: Record<string, string>, indent: string) =>
    [`${indent}color-scheme: ${scheme};`, ...Object.entries(theme).map(([role, v]) => `${indent}--${role}: ${v};`)].join("\n");
  const dark = resolveTheme(tokens, "dark");
  return [
    "/* Generated by scripts/build-tokens.ts from dashboard/design/tokens.json. Do not edit: run make tokens. */",
    "",
    ":root {",
    `  --font-sans: ${tokens.font.sans.value};`,
    `  --font-mono: ${tokens.font.mono.value};`,
    `  --radius-sm: ${tokens.radius.sm};`,
    `  --radius-md: ${tokens.radius.md};`,
    vars("light", resolveTheme(tokens, "light"), "  "),
    "}",
    "",
    ':root[data-theme="dark"] {',
    vars("dark", dark, "  "),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    '  :root:not([data-theme="light"]) {',
    vars("dark", dark, "    "),
    "  }",
    "}",
    "",
  ].join("\n");
}

// A colour written anywhere but tokens.css is a second palette no pair covers.
export const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/;
