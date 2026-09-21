/**
 * Draw every diagram in the workbook and the guide from a small description.
 *
 *   node scripts/diagram.mjs            write each figure into its page (make diagrams)
 *   node scripts/diagram.mjs --check    exit 1 if a figure on a page is not what the tool draws
 *
 * A page holds only <figure class="diagram" data-diagram="loop"></figure>. The picture, its
 * caption and its number come from design/diagrams/loop.json, so a hand edit to a figure is
 * a figure the next run overwrites and the check names.
 *
 * WHY THE CANVAS IS 504 UNITS WIDE
 *
 * The printed text width is 174 mm, about 493 pt. Drawn on a canvas 504 units wide, a unit
 * prints at 0.98 pt, so a label written at size 11 prints at about 10.8 pt. The old diagrams
 * were 1010 units wide and printed at half that, which is why they could not be read.
 *
 * Colours are token names. Every fill, stroke and text colour is a class (f-accent, s-line,
 * t-muted) that design/book.css binds to a token, so a diagram cannot carry a hex.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");
export const PAGES = ["workbook.html", "guide.html"];
export const CANVAS = 504;
/** Print width of the text block in points: 174 mm. */
export const PRINT_WIDTH_PT = (174 / 25.4) * 72;
/** The smallest a label may print, in points. The tool draws nothing below 8 units. */
export const MIN_PRINT_PT = 7.5;

const SIZE = { title: 11, label: 9.5, note: 8.5 };
const LEAD = { title: 14, label: 12.5, note: 11.5 };
const FIGURE = /<figure class="diagram" data-diagram="([a-z0-9-]+)">[\s\S]*?<\/figure>/g;

/* Text measure ---------------------------------------------------------------------------
 * The font is not loaded when this runs, so widths are estimated per character, a little
 * generous. A line that wraps early costs a space; a line that overflows costs the figure. */

const EM = { " ": 0.28, i: 0.25, l: 0.25, j: 0.26, t: 0.35, f: 0.33, r: 0.36, s: 0.5, I: 0.3, m: 0.87, w: 0.8, M: 0.9, W: 1.0 };
function measure(str, size, bold = false, mono = false) {
  let em = 0;
  for (const ch of str) {
    if (mono) em += 0.5;
    else if (ch in EM) em += EM[ch];
    else if (/[A-Z]/.test(ch)) em += 0.66;
    else if (/[0-9]/.test(ch)) em += 0.62;
    else if (/[.,;:'"!|()[\]/\\-]/.test(ch)) em += 0.3;
    else em += 0.57;
  }
  return em * size * (bold ? 1.07 : 1.03);
}

export function wrap(str, size, width, bold = false, mono = false) {
  const lines = [];
  let line = "";
  for (const word of String(str).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, size, bold, mono) <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (v) => Number(v.toFixed(1));

/* Tones -----------------------------------------------------------------------------------
 * dark and mark are emphasis, and a diagram may have one of each. */

const TONES = {
  plain: { fill: "f-card", stroke: "s-line", title: "t-ink", note: "t-muted" },
  quiet: { fill: "f-paper", stroke: "s-line", title: "t-muted", note: "t-muted", dash: true },
  dark: { fill: "f-fill-dark", stroke: "s-fill-dark", title: "t-paper", note: "t-paper" },
  mark: { fill: "f-accent", stroke: "s-accent-deep", title: "t-ink", note: "t-ink" },
  pass: { fill: "f-card", stroke: "s-pass", title: "t-pass", note: "t-muted", heavy: true },
  fail: { fill: "f-card", stroke: "s-fail", title: "t-fail", note: "t-muted", heavy: true },
  wait: { fill: "f-card", stroke: "s-wait", title: "t-wait", note: "t-muted", heavy: true },
};
const tone = (name = "plain") => {
  if (!(name in TONES)) throw new Error(`unknown tone "${name}", use one of ${Object.keys(TONES).join(", ")}`);
  return TONES[name];
};

class Canvas {
  constructor(id) {
    this.id = id;
    this.out = [];
    this.emphasis = { dark: 0, mark: 0 };
  }
  add(s) {
    this.out.push(s);
  }
  spend(name) {
    if (name in this.emphasis && ++this.emphasis[name] > 1) {
      throw new Error(`${this.id}: two "${name}" boxes. A diagram gets one dark and one mark, or neither means anything`);
    }
  }
  text(x, y, str, { size, cls, bold = false, mono = false, anchor = "start" }) {
    const extra = `${bold ? " b" : ""}${mono ? " m" : ""}`;
    const a = anchor === "start" ? "" : ` text-anchor="${anchor}"`;
    this.add(`<text x="${n(x)}" y="${n(y)}" font-size="${size}" class="${cls}${extra}"${a}>${esc(str)}</text>`);
  }
  rect(x, y, w, h, t, { r = 4 } = {}) {
    const dash = t.dash ? ' stroke-dasharray="3 3"' : "";
    const heavy = t.heavy ? ' stroke-width="1.5"' : "";
    this.add(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${r}" class="${t.fill} ${t.stroke}"${dash}${heavy}/>`);
  }
  line(x1, y1, x2, y2, { cls = "s-muted", dash = false } = {}) {
    this.add(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" class="${cls}"${dash ? ' stroke-dasharray="4 4"' : ""}/>`);
  }
  arrow(d, cls = "s-muted") {
    this.add(`<path d="${d}" class="${cls} arrow" marker-end="url(#a-${this.id})"/>`);
  }
}

/* A block of text: a bold title over muted notes. Returns its height so a caller can size a box. */
function blockHeight(width, title, notes, { titleSize = "title" } = {}) {
  const t = title ? wrap(title, SIZE[titleSize], width, true).length * LEAD[titleSize] : 0;
  const body = notes.reduce((sum, note) => sum + wrap(note, SIZE.note, width).length * LEAD.note + 2, 0);
  return t + body;
}
function drawBlock(c, x, y, width, title, notes, t, { titleSize = "title" } = {}) {
  let cy = y;
  if (title) {
    for (const line of wrap(title, SIZE[titleSize], width, true)) {
      cy += LEAD[titleSize];
      c.text(x, cy - 3.5, line, { size: SIZE[titleSize], cls: t.title, bold: true });
    }
  }
  for (const note of notes) {
    for (const line of wrap(note, SIZE.note, width)) {
      cy += LEAD.note;
      c.text(x, cy - 2.5, line, { size: SIZE.note, cls: t.note });
    }
    cy += 2;
  }
  return cy;
}
const asList = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const PAD = 9;

function box(c, x, y, w, h, step) {
  const t = tone(step.tone);
  c.spend(step.tone);
  c.rect(x, y, w, h, t);
  drawBlock(c, x + PAD, y + PAD - 2, w - 2 * PAD, step.title, asList(step.note), t);
}
const boxHeight = (w, step) => blockHeight(w - 2 * PAD, step.title, asList(step.note)) + 2 * PAD - 2;

/* Shapes ---------------------------------------------------------------------------------- */

const SHAPES = {
  /** Boxes left to right with arrows, in rows when there are many. */
  flow(c, spec) {
    const steps = spec.steps;
    const per = spec.per ?? (steps.length <= 4 ? steps.length : Math.ceil(steps.length / 2));
    const gap = per > 1 ? 18 : 0;
    const w = (CANVAS - 1 - gap * (per - 1)) / per;
    const rows = [];
    for (let i = 0; i < steps.length; i += per) rows.push(steps.slice(i, i + per));
    let y = 1;
    const centres = [];
    rows.forEach((row, r) => {
      const h = Math.max(...row.map((s) => boxHeight(w, s)));
      row.forEach((step, i) => {
        const x = 0.5 + i * (w + gap);
        box(c, x, y, w, h, step);
        if (i > 0) c.arrow(`M${n(x - gap + 2)} ${n(y + h / 2)} H${n(x - 1)}`);
      });
      centres.push({ y, h, first: 0.5 + w / 2, last: 0.5 + (row.length - 1) * (w + gap) + w / 2 });
      if (r < rows.length - 1) {
        // The line drops from the last box, runs back under the row and comes down onto the first box of the next.
        const yb = y + h;
        const ym = yb + 11;
        const next = y + h + 22;
        const last = centres[r].last;
        c.arrow(`M${n(last)} ${n(yb)} V${n(ym)} H${n(0.5 + w / 2)} V${n(next - 1)}`);
        y = next;
      } else y += h;
    });
    if (spec.back) {
      const { first, last } = centres[0];
      const yb = y + 12;
      c.arrow(`M${n(last)} ${n(y + 1)} V${n(yb)} H${n(first)} V${n(y + 2)}`, "s-muted");
      c.text(CANVAS / 2, yb + 11, spec.back, { size: SIZE.note, cls: "t-muted", anchor: "middle" });
      y = yb + 16;
    }
    return y;
  },

  /** Full width layers, one under another: a label on the left, what it does on the right. */
  stack(c, spec) {
    const labelW = spec.labelWidth ?? 132;
    let y = 1;
    for (const layer of spec.layers) {
      const t = tone(layer.tone);
      c.spend(layer.tone);
      const noteW = CANVAS - labelW - 3 * PAD;
      const h = Math.max(
        blockHeight(labelW - 2 * PAD, layer.title, []) + 2 * PAD - 2,
        blockHeight(noteW, "", asList(layer.note)) + 2 * PAD - 2,
        30,
      );
      c.rect(0.5, y, CANVAS - 1, h, t);
      if (layer.tone !== "dark" && layer.tone !== "mark") c.line(labelW + 0.5, y + 6, labelW + 0.5, y + h - 6, { cls: "s-line" });
      drawBlock(c, 0.5 + PAD, y + PAD - 2, labelW - 2 * PAD, layer.title, [], t);
      drawBlock(c, labelW + PAD + 0.5, y + PAD - 2, noteW, "", asList(layer.note), { ...t, note: t.note });
      y += h + 5;
    }
    return y - 5;
  },

  /** Two sides compared, or a before and an after when `arrow` is set. */
  split(c, spec) {
    const gap = spec.arrow ? 60 : 14;
    const w = (CANVAS - 1 - gap) / 2;
    const sides = [spec.left, spec.right];
    const tones = sides.map((s) => s.tone ?? "plain");
    const contentH = (s) => {
      const items = asList(s.items).map((i) => (typeof i === "string" ? { text: i } : i));
      return 20 + items.reduce((sum, i) => sum + wrap(i.text, SIZE.label, w - 2 * PAD - 12).length * LEAD.label + 4, 0) + PAD;
    };
    const h = Math.max(...sides.map(contentH));
    sides.forEach((s, i) => {
      const x = 0.5 + i * (w + gap);
      const t = tone(tones[i]);
      c.spend(tones[i]);
      c.rect(x, 1, w, h, t);
      c.text(x + PAD, 1 + 16, s.title, { size: SIZE.title, cls: t.title, bold: true });
      let cy = 1 + 22;
      for (const raw of asList(s.items)) {
        const item = typeof raw === "string" ? { text: raw } : raw;
        const dot = item.tone ? `f-${item.tone}` : tones[i] === "dark" ? "f-paper" : "f-muted";
        const lines = wrap(item.text, SIZE.label, w - 2 * PAD - 12);
        c.add(`<circle cx="${n(x + PAD + 3)}" cy="${n(cy + 8)}" r="2.6" class="${dot}"/>`);
        for (const line of lines) {
          cy += LEAD.label;
          c.text(x + PAD + 12, cy - 3, line, { size: SIZE.label, cls: tones[i] === "dark" ? "t-paper" : "t-ink" });
        }
        cy += 4;
      }
    });
    if (spec.arrow) {
      const mid = 0.5 + w + gap / 2;
      c.arrow(`M${n(mid - 17)} ${n(1 + h / 2)} H${n(mid + 17)}`);
      wrap(spec.arrow, SIZE.note, gap - 4).forEach((line, i) => c.text(mid, 1 + h / 2 + 14 + i * 10, line, { size: SIZE.note, cls: "t-muted", anchor: "middle" }));
    }
    return 1 + h;
  },

  /** One thing on the left that leads to, or comes from, several on the right. */
  fan(c, spec) {
    const leftW = spec.leftWidth ?? 150;
    const gap = 44;
    const rightW = CANVAS - 1 - leftW - gap;
    const targets = spec.to;
    const heights = targets.map((s) => boxHeight(rightW, s));
    const total = heights.reduce((a, b) => a + b, 0) + 8 * (targets.length - 1);
    const leftH = Math.max(boxHeight(leftW, spec.from), 40);
    const H = Math.max(total, leftH);
    const ly = 1 + (H - leftH) / 2;
    box(c, 0.5, ly, leftW, leftH, spec.from);
    let y = 1 + (H - total) / 2;
    const into = spec.direction === "in";
    for (const [i, step] of targets.entries()) {
      const x = 0.5 + leftW + gap;
      box(c, x, y, rightW, heights[i], step);
      const cy = y + heights[i] / 2;
      const lx = 0.5 + leftW;
      const path = `M${n(lx + 2)} ${n(ly + leftH / 2)} H${n(lx + gap / 2)} V${n(cy)} H${n(x - 1)}`;
      c.arrow(into ? `M${n(x - 2)} ${n(cy)} H${n(lx + gap / 2)} V${n(ly + leftH / 2)} H${n(lx + 1)}` : path);
      y += heights[i] + 8;
    }
    return 1 + H;
  },

  /** Bars on a shared time axis: when each stage started and how long it ran. */
  timeline(c, spec) {
    const labelW = spec.labelWidth ?? 120;
    const barX = labelW + 6;
    const barW = CANVAS - barX - 1;
    const scale = barW / spec.total;
    const rowH = 24;
    let y = 4;
    for (const row of spec.rows) {
      c.text(0.5, y + 14, row.label, { size: SIZE.label, cls: "t-ink", bold: true });
      const w = Math.max(row.length * scale, 2);
      const fill = row.tone === "mark" ? (c.spend("mark"), "f-accent s-accent-deep") : row.tone ? `f-${row.tone} s-${row.tone}` : "f-muted s-muted";
      c.add(`<rect x="${n(barX + row.start * scale)}" y="${n(y + 3)}" width="${n(w)}" height="14" rx="2" class="${fill}"/>`);
      if (row.note) {
        const after = barX + (row.start + row.length) * scale;
        const need = measure(row.note, SIZE.note) + 6;
        const fits = after + need < CANVAS;
        const before = row.start * scale > need;
        // A bar that fills the axis leaves no room beside it, so the note sits inside it in paper ink.
        if (fits || before) c.text(fits ? after + 5 : barX + row.start * scale - 5, y + 14, row.note, { size: SIZE.note, cls: "t-muted", anchor: fits ? "start" : "end" });
        else c.text(after - 6, y + 14, row.note, { size: SIZE.note, cls: "t-paper", anchor: "end" });
      }
      y += rowH;
    }
    c.line(barX, y - 2, CANVAS - 0.5, y - 2, { cls: "s-line" });
    const ticks = spec.ticks ?? 4;
    for (let i = 0; i <= ticks; i++) {
      const value = (spec.total / ticks) * i;
      const x = barX + value * scale;
      c.line(x, y - 2, x, y + 2, { cls: "s-line" });
      c.text(x, y + 13, `${Number.isInteger(value) ? value : value.toFixed(1)}${spec.unit ?? ""}`, { size: SIZE.note, cls: "t-muted", anchor: i === ticks ? "end" : i === 0 ? "start" : "middle" });
    }
    return y + 20;
  },

  /** Rows against columns. One cell may be marked. */
  matrix(c, spec) {
    const cols = spec.cols;
    const first = spec.labelWidth ?? 100;
    const cw = (CANVAS - first - 1) / cols.length;
    let y = 1;
    const headH = Math.max(...cols.map((h) => wrap(h, SIZE.label, cw - 8, true).length)) * LEAD.label + 8;
    cols.forEach((h, i) => {
      wrap(h, SIZE.label, cw - 8, true).forEach((line, k) => c.text(first + i * cw + 4, y + 14 + k * LEAD.label - 2, line, { size: SIZE.label, cls: "t-ink", bold: true }));
    });
    if (spec.corner) c.text(0.5, y + 12, spec.corner, { size: SIZE.note, cls: "t-muted" });
    y += headH;
    c.line(0.5, y, CANVAS - 0.5, y, { cls: "s-ink" });
    for (const row of spec.rows) {
      const cells = row.cells.map((cell) => (typeof cell === "string" ? { text: cell } : cell));
      const h =
        Math.max(
          wrap(row.label, SIZE.label, first - 8, true).length * LEAD.label,
          ...cells.map((cell) => wrap(cell.text, SIZE.note, cw - 10).length * LEAD.note + 2),
        ) + 12;
      cells.forEach((cell, i) => {
        if (cell.tone === "mark") {
          c.spend("mark");
          c.add(`<rect x="${n(first + i * cw + 1)}" y="${n(y + 2)}" width="${n(cw - 2)}" height="${n(h - 4)}" rx="3" class="f-accent s-accent-deep"/>`);
        }
        const cls = cell.tone === "mark" ? "t-ink" : cell.tone ? `t-${cell.tone}` : "t-ink";
        wrap(cell.text, SIZE.note, cw - 10).forEach((line, k) =>
          c.text(first + i * cw + 5, y + 6 + LEAD.note + k * LEAD.note - 2, line, { size: SIZE.note, cls, bold: Boolean(cell.tone && cell.tone !== "mark") }),
        );
      });
      wrap(row.label, SIZE.label, first - 8, true).forEach((line, k) => c.text(0.5, y + 6 + LEAD.label + k * LEAD.label - 3, line, { size: SIZE.label, cls: "t-ink", bold: true }));
      y += h;
      c.line(0.5, y, CANVAS - 0.5, y, { cls: "s-line" });
    }
    return y;
  },

  /** A line over time with a band, thresholds and labelled points. */
  chart(c, spec) {
    const left = 34;
    const top = spec.ylabel ? 20 : 6;
    const H = spec.height ?? 130;
    const w = CANVAS - left - 6;
    const sx = (x) => left + (x / spec.xmax) * w;
    const sy = (y) => top + H - (y / spec.ymax) * H;
    for (const band of spec.bands ?? []) {
      const [x1, x2] = [sx(band.x1), sx(band.x2)];
      c.add(`<rect x="${n(x1)}" y="${n(sy(band.y2))}" width="${n(x2 - x1)}" height="${n(sy(band.y1) - sy(band.y2))}" class="f-line band"/>`);
      if (band.label) c.text(x1 + 4, sy(band.y2) + 11, band.label, { size: SIZE.note, cls: "t-muted" });
    }
    c.line(left, top, left, top + H, { cls: "s-muted" });
    c.line(left, top + H, left + w, top + H, { cls: "s-muted" });
    if (spec.ylabel) c.text(0.5, top - 8, spec.ylabel, { size: SIZE.note, cls: "t-muted" });
    if (spec.xlabel) c.text(left + w, top + H + 14, spec.xlabel, { size: SIZE.note, cls: "t-muted", anchor: "end" });
    for (const ln of spec.lines ?? []) {
      c.add(`<line x1="${left}" y1="${n(sy(ln.y))}" x2="${left + w}" y2="${n(sy(ln.y))}" class="s-${ln.tone ?? "muted"}" stroke-dasharray="4 3" stroke-width="1.25"/>`);
      const atLeft = ln.side === "left";
      c.text(atLeft ? left + 5 : left + w, sy(ln.y) - 4, ln.label, { size: SIZE.note, cls: `t-${ln.tone ?? "muted"}`, anchor: atLeft ? "start" : "end", bold: Boolean(ln.tone) });
    }
    const pts = spec.series.map(([x, y]) => `${n(sx(x))},${n(sy(y))}`).join(" ");
    c.add(`<polyline points="${pts}" class="s-ink line" fill="none" stroke-width="1.75"/>`);
    for (const p of spec.points ?? []) {
      const t = tone(p.tone ?? "plain");
      const cls = p.tone === "mark" ? (c.spend("mark"), "f-accent s-accent-deep") : p.tone ? `f-${p.tone} s-${p.tone}` : "f-card s-ink";
      c.add(`<circle cx="${n(sx(p.x))}" cy="${n(sy(p.y))}" r="4.5" class="${cls}" stroke-width="1.5"/>`);
      if (p.label) c.text(sx(p.x) + (p.side === "left" ? -9 : 9), sy(p.y) + (p.below ? 14 : -7), p.label, { size: SIZE.label, cls: "t-ink", anchor: p.side === "left" ? "end" : "start", bold: true });
      void t;
    }
    return top + H + (spec.xlabel ? 24 : 12);
  },
  /** A path of boxes with a stop across it. Each stop has a box beneath it: where the refusal lands. */
  gate(c, spec) {
    const steps = spec.path;
    const stops = new Map((spec.gates ?? []).map((g) => [g.after, g]));
    const gaps = steps.slice(1).map((_, i) => (stops.has(i) ? 44 : 18));
    const w = (CANVAS - 1 - gaps.reduce((a, b) => a + b, 0)) / steps.length;
    const h = Math.max(...steps.map((s) => boxHeight(w, s)));
    const refusals = [];
    let x = 0.5;
    steps.forEach((step, i) => {
      box(c, x, 1, w, h, step);
      if (i < steps.length - 1) {
        const mid = x + w + gaps[i] / 2;
        c.arrow(`M${n(x + w + 2)} ${n(1 + h / 2)} H${n(x + w + gaps[i] - 1)}`);
        if (stops.has(i)) {
          c.add(`<line x1="${n(mid)}" y1="${n(1 + h / 2 - 15)}" x2="${n(mid)}" y2="${n(1 + h / 2 + 15)}" class="s-fail" stroke-width="3"/>`);
          refusals.push({ mid, out: stops.get(i).refuse });
        }
        x += w + gaps[i];
      }
    });
    const rw = Math.min(150, w + 20);
    const top = 1 + h + 26;
    let bottom = 1 + h;
    for (const { mid, out } of refusals) {
      const step = { title: out, tone: "fail" };
      const rx = Math.min(Math.max(mid - rw / 2, 0.5), CANVAS - 0.5 - rw);
      const rh = boxHeight(rw, step);
      c.arrow(`M${n(mid)} ${n(1 + h / 2 + 17)} V${n(top - 1)}`, "s-fail");
      box(c, rx, top, rw, rh, step);
      bottom = Math.max(bottom, top + rh);
    }
    return bottom;
  },

  /** Two lines over the same axis: one that keeps climbing and one that stays flat. */
  growth(c, spec) {
    const left = 10;
    const top = spec.ylabel ? 22 : 8;
    const H = spec.height ?? 110;
    const labelW = 132;
    const w = CANVAS - left - labelW - 8;
    const at = (t, level) => [left + t * w, top + H - level * H];
    if (spec.ylabel) c.text(left, top - 9, spec.ylabel, { size: SIZE.note, cls: "t-muted" });
    c.line(left, top, left, top + H, { cls: "s-muted" });
    c.line(left, top + H, left + w, top + H, { cls: "s-muted" });
    if (spec.mark) {
      const [mx] = at(spec.mark.at, 0);
      c.line(mx, top, mx, top + H, { cls: "s-line", dash: true });
      c.text(mx - 5, top + 10, spec.mark.label, { size: SIZE.note, cls: "t-muted", anchor: "end" });
    }
    const rising = Array.from({ length: 21 }, (_, i) => at(i / 20, 0.12 + 0.86 * (i / 20) ** 1.8).map(n).join(",")).join(" ");
    c.add(`<polyline points="${rising}" class="s-${spec.rising.tone ?? "fail"} line" fill="none" stroke-width="2"/>`);
    const flat = `${at(0, 0.12).map(n).join(",")} ${at(1, 0.12).map(n).join(",")}`;
    c.add(`<polyline points="${flat}" class="s-${spec.flat.tone ?? "pass"} line" fill="none" stroke-width="2"/>`);
    const ends = [
      [spec.rising, at(1, 0.98)[1], spec.rising.tone ?? "fail"],
      [spec.flat, at(1, 0.12)[1], spec.flat.tone ?? "pass"],
    ];
    for (const [end, y, t] of ends) {
      wrap(end.label, SIZE.label, labelW, true).forEach((line, k) => c.text(left + w + 8, y + 4 + k * LEAD.label, line, { size: SIZE.label, cls: `t-${t}`, bold: true }));
    }
    if (spec.xlabel) c.text(left + w, top + H + 14, spec.xlabel, { size: SIZE.note, cls: "t-muted", anchor: "end" });
    return top + H + (spec.xlabel ? 22 : 8);
  },

  /** Rings inside rings: what is inside, and what stays outside. The innermost ring may be marked. */
  scope(c, spec) {
    const rings = spec.rings;
    const k = rings.length;
    const bottom = 1 + k * 26 + k * 10 + 8;
    rings.forEach((ring, i) => {
      const t = tone(ring.tone);
      c.spend(ring.tone);
      const x = 0.5 + i * 18;
      const y = 1 + i * 26;
      const w = CANVAS - 1 - i * 36;
      c.rect(x, y, w, bottom - i * 10 - y, t);
      c.text(x + 10, y + 17, ring.title, { size: SIZE.title, cls: t.title, bold: true });
      let px = x + w - 10;
      for (const item of [...asList(ring.items)].reverse()) {
        const pw = measure(item, SIZE.note) + 14;
        px -= pw;
        c.add(`<rect x="${n(px)}" y="${n(y + 6)}" width="${n(pw)}" height="17" rx="8.5" class="f-paper s-line"/>`);
        c.text(px + pw / 2, y + 18, item, { size: SIZE.note, cls: "t-ink", anchor: "middle" });
        px -= 5;
      }
    });
    return bottom;
  },

  /** The same object before and after. Rows line up, and a changed row carries an arrow across.
   * The left value reads red and the right green, unless the row says `flip` because the right is worse. */
  pair(c, spec) {
    const gap = 46;
    const w = (CANVAS - 1 - gap) / 2;
    const labelW = spec.labelWidth ?? 84;
    const valW = w - labelW - 2 * PAD;
    const sides = ["left", "right"];
    const heights = spec.rows.map((r) => Math.max(wrap(r.label, SIZE.label, labelW - 4, true).length * LEAD.label, ...sides.map((s) => wrap(r[s], SIZE.label, valW).length * LEAD.label)) + 8);
    const H = 26 + heights.reduce((a, b) => a + b, 0) + 4;
    sides.forEach((side, si) => {
      const t = tone(spec[side].tone);
      c.spend(spec[side].tone);
      const x = 0.5 + si * (w + gap);
      c.rect(x, 1, w, H, t);
      c.text(x + PAD, 17, spec[side].title, { size: SIZE.title, cls: t.title, bold: true });
      let y = 1 + 26;
      spec.rows.forEach((row, ri) => {
        wrap(row.label, SIZE.label, labelW - 4, true).forEach((line, k) => c.text(x + PAD, y + 15 + k * LEAD.label - 3, line, { size: SIZE.label, cls: t.title === "t-paper" ? "t-paper" : "t-muted", bold: true }));
        const cls = row.changed ? (si === (row.flip ? 1 : 0) ? "t-fail" : "t-pass") : t.title === "t-paper" ? "t-paper" : "t-ink";
        wrap(row[side], SIZE.label, valW).forEach((line, k) => c.text(x + PAD + labelW, y + 15 + k * LEAD.label - 3, line, { size: SIZE.label, cls, bold: Boolean(row.changed) }));
        y += heights[ri];
        if (ri < spec.rows.length - 1 && !["dark", "mark"].includes(spec[side].tone)) c.line(x + PAD, y, x + w - PAD, y, { cls: "s-line" });
      });
    });
    let y = 1 + 26;
    spec.rows.forEach((row, ri) => {
      if (row.changed) c.arrow(`M${n(0.5 + w + 6)} ${n(y + heights[ri] / 2)} H${n(0.5 + w + gap - 6)}`);
      y += heights[ri];
    });
    return 1 + H;
  },
};

/* The budget -------------------------------------------------------------------------------
 * A label names a thing. A sentence that explains it belongs in the caption, where it wraps,
 * stays selectable and reads as prose. Boxes full of sentences are what made the first
 * figures look like text set in rectangles. */

export const LIMITS = { words: 6, figure: 34 };
const NOT_LABELS = new Set(["alt", "caption", "shape", "tone", "unit", "side", "direction", "below", "per", "labelWidth", "leftWidth", "height", "ticks", "at", "after", "changed"]);
const wordCount = (str) => str.trim().split(/\s+/).length;

/** Every string a figure draws, which is every string in its description except alt and caption. */
export function labels(spec) {
  const out = [];
  const walk = (v, key) => {
    if (typeof v === "string") {
      if (!NOT_LABELS.has(key)) out.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(spec, "");
  return out;
}

/** What is wrong with one figure's description, in the words a person editing it needs. */
export function problems(id, spec) {
  const found = [];
  if ("foot" in spec) found.push(`${id}: "foot" is gone. A sentence under a figure belongs in its caption`);
  const seen = [];
  const walk = (v, key) => {
    if (key === "note" && Array.isArray(v)) found.push(`${id}: "note" is one short label, not a list of sentences`);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(spec, "");
  for (const label of labels(spec)) {
    seen.push(label);
    if (wordCount(label) > LIMITS.words) found.push(`${id}: "${label}" is ${wordCount(label)} words. A label names a thing, so ${LIMITS.words} at most; the explaining goes in the caption`);
  }
  const total = seen.reduce((sum, l) => sum + wordCount(l), 0);
  if (total > LIMITS.figure) found.push(`${id}: ${total} words drawn, ${LIMITS.figure} at most. Draw the parts and let the caption explain`);
  if (spec.shape === "split" && !spec.arrow) found.push(`${id}: a split with no arrow is two lists in boxes. Use a shape with geometry, or add an arrow for a before and after`);
  return found;
}

/* Figures --------------------------------------------------------------------------------- */

export function drawSvg(id, spec) {
  const shape = SHAPES[spec.shape];
  if (!shape) throw new Error(`${id}: unknown shape "${spec.shape}", use one of ${Object.keys(SHAPES).join(", ")}`);
  if (!spec.alt) throw new Error(`${id}: a diagram needs "alt", the sentence a screen reader says`);
  const wrong = problems(id, spec);
  if (wrong.length) throw new Error(wrong.join("\n"));
  const c = new Canvas(id);
  const bottom = shape(c, spec);
  const height = Math.ceil(bottom + 2);
  const defs = `<defs><marker id="a-${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" class="f-muted"/></marker></defs>`;
  return `<svg viewBox="0 0 ${CANVAS} ${height}" role="img" aria-labelledby="t-${id}">\n<title id="t-${id}">${esc(spec.alt)}</title>\n${defs}\n${c.out.join("\n")}\n</svg>`;
}

export function drawFigure(id, spec, number) {
  if (!spec.caption) throw new Error(`${id}: a diagram needs a "caption"`);
  return `<figure class="diagram" data-diagram="${id}">\n${drawSvg(id, spec)}\n<figcaption><span class="no">Figure ${number}</span> ${esc(spec.caption)}</figcaption>\n</figure>`;
}

export function specs() {
  const dir = join(ROOT, "design/diagrams");
  const found = {};
  if (!existsSync(dir)) return found;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "exempt.json")) {
    found[file.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, file), "utf8"));
  }
  return found;
}

/** A page with every figure redrawn. Figures are numbered in the order they appear. */
export function render(page, all) {
  let number = 0;
  return page.replace(FIGURE, (_whole, id) => {
    if (!all[id]) throw new Error(`the page places diagram "${id}" and design/diagrams/${id}.json does not exist`);
    return drawFigure(id, all[id], ++number);
  });
}

/** Every figure the tool would draw, and the ones on the page that differ. */
export function stale(page, all) {
  const want = render(page, all);
  if (want === page) return [];
  const a = [...page.matchAll(FIGURE)].map((m) => m[0]);
  const b = [...want.matchAll(FIGURE)].map((m) => m[0]);
  return a.flatMap((figure, i) => (figure === b[i] ? [] : [/data-diagram="([a-z0-9-]+)"/.exec(figure)[1]]));
}

const main = () => {
  const all = specs();
  if (process.argv.includes("--audit")) {
    const found = Object.entries(all).flatMap(([id, spec]) => problems(id, spec));
    for (const line of found) console.error(line);
    process.exit(found.length ? 1 : 0);
  }
  const check = process.argv.includes("--check");
  let differing = 0;
  for (const name of PAGES) {
    const path = join(ROOT, name);
    if (!existsSync(path)) continue;
    const page = readFileSync(path, "utf8");
    const off = stale(page, all);
    if (check) {
      differing += off.length;
      for (const id of off) console.error(`${name}: figure "${id}" is not what design/diagrams/${id}.json draws, run make diagrams`);
    } else if (off.length || render(page, all) !== page) {
      writeFileSync(path, render(page, all));
      console.log(`${name}: ${[...page.matchAll(FIGURE)].length} figures drawn`);
    }
  }
  if (check && differing) process.exit(1);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
