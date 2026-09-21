/**
 * Colour every code block in the workbook and the guide from its plain text.
 *
 *   node scripts/highlight.mjs            rewrite each block in its page (make diagrams)
 *   node scripts/highlight.mjs --check    exit 1 if a block is not what this tool writes
 *
 * A page holds <pre data-lang="sql">SELECT 1</pre>. An optional data-from="workshop/x.sql#name"
 * says which lab file the block is copied from; tests/test_highlight.py checks the copy is exact. The tool strips any markup inside, reads
 * the plain text, and writes it back with four kinds of span: keyword, string, number and
 * comment. The output is a pure function of the plain text, so a hand edit inside a block
 * is a block the next run overwrites and --check names.
 *
 * The colours are token classes (hl-k, hl-s, hl-n, hl-c) that design/book.css binds to the
 * brand palette. A block carries no hex, and design/tokens.json pins each pair's contrast.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");
export const PAGES = ["workbook.html", "guide.html"];
export const LANGS = ["sql", "bash", "json", "ts", "python", "xml", "tools", "text"];

const words = (s) => new Set(s.split(/\s+/));
const SQL = words(
  "select from where and or not in is null as group by order having limit offset join left right inner outer on with union all distinct case when then else end between like desc asc interval create table insert into values update set delete exists over partition array any if",
);
const TS = words(
  "const let var function return if else for while of in new class extends import export from as type interface async await try catch throw true false null undefined typeof void default switch case break continue",
);
const PY = words(
  "def class return if elif else for while in not and or is import from as with try except finally raise lambda None True False pass yield async await",
);
const SHELL = words("if then else fi for do done while case esac export in");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const span = (cls, text) => `<span class="hl-${cls}">${esc(text)}</span>`;

/** Turn plain text into tokens: [class | null, text]. `rules` are tried in order at each position. */
function tokenize(src, rules) {
  const out = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push([null, plain]);
    plain = "";
  };
  for (let i = 0; i < src.length; ) {
    let hit = null;
    for (const [cls, re, keep] of rules) {
      re.lastIndex = i;
      const m = re.exec(src);
      if (m && m.index === i && m[0].length) {
        if (!keep || keep(m[0], src, i)) {
          hit = [cls, m[0]];
          break;
        }
      }
    }
    if (hit) {
      flush();
      out.push(hit);
      i += hit[1].length;
    } else {
      plain += src[i++];
    }
  }
  flush();
  return out;
}

const STRING = ["s", /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/y];
const NUMBER = ["n", /\b\d+(?:\.\d+)?\b/y];
const WORD = (set, ci = false) => ["k", /[A-Za-z_][A-Za-z0-9_]*/y, (w, src, i) => (ci ? set.has(w.toLowerCase()) : set.has(w)) && !/[A-Za-z0-9_]/.test(src[i - 1] ?? "")];

/** Each language is the rules that recognise it. Anything no rule claims stays plain. */
const LANG = {
  sql: [["c", /--[^\n]*/y], STRING, NUMBER, WORD(SQL, true)],
  ts: [["c", /\/\/[^\n]*|\/\*[\s\S]*?\*\//y], STRING, NUMBER, WORD(TS)],
  python: [["c", /#[^\n]*/y], STRING, NUMBER, WORD(PY)],
  xml: [["c", /<!--[\s\S]*?-->/y], ["k", /<\/?[A-Za-z][\w:-]*/y], STRING, NUMBER],
  json: [
    ["k", /"(?:[^"\\\n]|\\.)*"(?=\s*:)/y],
    STRING,
    NUMBER,
    ["k", /\b(?:true|false|null)\b/y],
  ],
  bash: [
    ["c", /#[^\n]*/y, (_w, src, i) => i === 0 || /\s/.test(src[i - 1])],
    ["c", /\$ /y, (_w, src, i) => /^\s*$/.test(src.slice(src.lastIndexOf("\n", i - 1) + 1, i))],
    STRING,
    // the command word at the start of a line, then each flag
    ["k", /[A-Za-z][\w.-]*/y, (_w, src, i) => /^\s*(?:\$ )?$/.test(src.slice(src.lastIndexOf("\n", i - 1) + 1, i))],
    ["n", /--?[A-Za-z][\w-]*(?:=[^\s'"]+)?/y],
    WORD(SHELL),
  ],
  // A list of names, each with a comment after it: the first word of a line is the name.
  tools: [
    ["c", /--[^\n]*/y],
    ["k", /[A-Za-z_][\w]*/y, (_w, src, i) => i === 0 || src[i - 1] === "\n"],
  ],
  text: [],
};

/** The plain text of a block: markup out, entities back, one leading newline dropped. */
export function plainText(inner) {
  return unesc(inner.replace(/<[^>]+>/g, "")).replace(/^\n/, "");
}

export function highlight(lang, plain) {
  const rules = LANG[lang];
  if (!rules) throw new Error(`unknown code language "${lang}", use one of ${LANGS.join(", ")}`);
  return tokenize(plain, rules)
    .map(([cls, text]) => (cls ? span(cls, text) : esc(text)))
    .join("");
}

const BLOCK = /<pre data-lang="([a-z]+)"((?: data-from="[^"]*")?)>([\s\S]*?)<\/pre>/g;
const ANY_PRE = /<pre(?![^>]*data-lang=)[^>]*>/g;

export function render(page) {
  return page.replace(BLOCK, (_m, lang, from, inner) => `<pre data-lang="${lang}"${from}>${highlight(lang, plainText(inner))}</pre>`);
}

/** The blocks whose markup is not what render writes, and the pre elements that name no language. */
export function stale(page) {
  const off = [];
  for (const m of page.matchAll(BLOCK)) {
    if (highlight(m[1], plainText(m[3])) !== m[3]) off.push(plainText(m[3]).split("\n")[0].slice(0, 50));
  }
  return off;
}

export const unlabelled = (page) => [...page.matchAll(ANY_PRE)].length;

const main = () => {
  const check = process.argv.includes("--check");
  let bad = 0;
  for (const name of PAGES) {
    const path = join(ROOT, name);
    if (!existsSync(path)) continue;
    const page = readFileSync(path, "utf8");
    if (check) {
      for (const first of stale(page)) {
        bad++;
        console.error(`${name}: the code block starting "${first}" is not what scripts/highlight.mjs writes, run make diagrams`);
      }
      const bare = unlabelled(page);
      if (bare) {
        bad += bare;
        console.error(`${name}: ${bare} <pre> without data-lang, name a language (${LANGS.join(", ")})`);
      }
    } else if (render(page) !== page) {
      writeFileSync(path, render(page));
      console.log(`${name}: ${[...page.matchAll(BLOCK)].length} code blocks coloured`);
    }
  }
  if (bad) process.exit(1);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
