/**
 * Parses a ```graph fenced block into a renderable spec.
 *
 * Deliberately a small, forgiving line language rather than JSON, because a
 * model writing a maths answer produces this shape far more reliably:
 *
 *   graph
 *   title: Parabola
 *   x: -4..4
 *   y: -2..10
 *   a = 1..4
 *   y = a x^2 - 2x + 1
 *   y = 2x + 1 | color: #7aa2f7, dashed
 *   point (1, 0) | label: vertex
 *   line y = 3
 *   table x: -2, -1, 0, 1, 2 | y: 4, 1, 0, 1, 4
 *
 * Only expressions that `compileExpression` accepts will ever run.
 */

import {
  compileExpression,
  evalConstant,
  isReservedName,
  parametersOf,
  type Compiled,
} from "../math/expression";

/**
 * Curve colours, resolved through CSS variables so the same spec stays legible
 * on the light and dark canvases. See --g1..--g6 in globals.css.
 */
export const PALETTE = [
  "var(--g1)",
  "var(--g2)",
  "var(--g3)",
  "var(--g4)",
  "var(--g5)",
  "var(--g6)",
];

export interface PlotSpec {
  expr: string;
  compiled: Compiled;
  color: string;
  label?: string;
  dashed?: boolean;
  /** Slider parameters this curve reads, e.g. ["a"] for `a x^2`. */
  params: string[];
}

/** A slider: a named parameter with a range and a starting value. */
export interface ParamSpec {
  name: string;
  min: number;
  max: number;
  value: number;
  step: number;
}

export interface PointSpec {
  x: number;
  y: number;
  color: string;
  label?: string;
}

export interface LineSpec {
  axis: "v" | "h";
  value: number;
  color: string;
  label?: string;
}

/** A set of sample points, drawn as markers. */
export interface TableSpec {
  points: { x: number; y: number }[];
  color: string;
  label?: string;
  /** True when the points should also be joined by a line. */
  connect: boolean;
}

export interface GraphSpec {
  title?: string;
  xMin: number;
  xMax: number;
  yMin?: number;
  yMax?: number;
  plots: PlotSpec[];
  points: PointSpec[];
  lines: LineSpec[];
  params: ParamSpec[];
  tables: TableSpec[];
}

export type GraphParse = { ok: true; spec: GraphSpec } | { ok: false; error: string };

interface Options {
  color?: string;
  label?: string;
  dashed?: boolean;
  connect?: boolean;
}

export function parseGraphSpec(source: string): GraphParse {
  const lines = source.split("\n");
  const spec: GraphSpec = {
    xMin: -10,
    xMax: 10,
    plots: [],
    points: [],
    lines: [],
    params: [],
    tables: [],
  };
  let nextColor = 0;
  const takeColor = (explicit?: string) => explicit ?? PALETTE[nextColor++ % PALETTE.length];
  const params = new Map<string, ParamSpec>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const lower = line.toLowerCase();

    // A table line uses "|" to separate its own x and y columns, so its options
    // (if any) come after the second "|" rather than the first.
    if (lower.startsWith("table")) {
      const pieces = line.split("|");
      const options = parseOptions(pieces.slice(2).join("|"));
      const table = parseTable(
        pieces.slice(0, 2).join("|").slice(5).trim(),
        takeColor(options.color),
        options,
      );
      if (!table) return fail(`Could not read the table "${line}". Use table x: 1, 2 | y: 3, 4.`);
      spec.tables.push(table);
      continue;
    }

    const [body, ...optionParts] = splitOnce(line, "|");
    const options = parseOptions(optionParts.join("|"));

    if (lower.startsWith("title:")) {
      spec.title = body.slice(6).trim();
      continue;
    }

    if (lower.startsWith("x:")) {
      const range = parseRange(body.slice(2).trim());
      if (!range) return fail(`Could not read the x range "${body.slice(2).trim()}". Use x: -10..10.`);
      [spec.xMin, spec.xMax] = range;
      continue;
    }

    if (lower.startsWith("y:")) {
      const range = parseRange(body.slice(2).trim());
      if (!range) return fail(`Could not read the y range "${body.slice(2).trim()}". Use y: -5..5.`);
      [spec.yMin, spec.yMax] = range;
      continue;
    }

    if (lower.startsWith("point")) {
      const rest = body.slice(5).replace(/[()]/g, "").trim();
      const coords = rest.split(",").map((p) => p.trim());
      if (coords.length !== 2) return fail(`Could not read the point "${body}". Use point (1, 2).`);
      const x = constant(coords[0]);
      const y = constant(coords[1]);
      if (x === null || y === null) return fail(`Could not read the point "${body}".`);
      spec.points.push({ x, y, color: takeColor(options.color), label: options.label });
      continue;
    }

    if (lower.startsWith("line")) {
      const rest = body.slice(4).trim();
      const vertical = /^x\s*=/.test(rest);
      const value = constant(rest.replace(/^[xy]\s*=\s*/, "").trim());
      if (value === null) return fail(`Could not read the line "${body}". Use line y = 3.`);
      spec.lines.push({
        axis: vertical ? "v" : "h",
        value,
        color: options.color ?? "var(--ink-450)",
        label: options.label,
      });
      continue;
    }

    // "a = 1..4" or "a = 2" declares a slider.
    if (isParamLine(body)) {
      const param = parseParam(body);
      if (param) params.set(param.name, param);
      continue;
    }

    // Anything left is a curve: "y = ...", "plot ...", or a bare expression.
    const expr = body.replace(/^(y\s*=|plot\s+|f\s*\(\s*x\s*\)\s*=)/i, "").trim();
    if (!expr) continue;

    let compiled: Compiled;
    try {
      compiled = compileExpression(expr);
    } catch (error) {
      return fail(`Could not read the formula "${expr}": ${(error as Error).message}`);
    }

    const needed = parametersOf(expr);
    const scope = scopeFrom(params, needed);

    // Verify it produces at least one finite value so we never render a blank card.
    let anyFinite = false;
    for (let i = 0; i <= 40; i++) {
      const x = spec.xMin + ((spec.xMax - spec.xMin) * i) / 40;
      if (Number.isFinite(compiled(x, scope))) {
        anyFinite = true;
        break;
      }
    }
    if (!anyFinite) return fail(`"${expr}" has no finite values in the given range.`);

    spec.plots.push({
      expr,
      compiled,
      color: takeColor(options.color),
      label: options.label,
      dashed: options.dashed,
      params: needed,
    });
  }

  // Any parameter a curve needs but the spec never declared gets a default
  // range, so the sliders always exist for what is drawn.
  for (const plot of spec.plots) {
    for (const name of plot.params) {
      if (!params.has(name)) params.set(name, defaultParam(name));
    }
  }
  spec.params = [...params.values()];

  if (
    spec.plots.length === 0 &&
    spec.points.length === 0 &&
    spec.lines.length === 0 &&
    spec.tables.length === 0
  ) {
    return fail("A graph needs at least one curve, point or line.");
  }
  if (spec.xMax <= spec.xMin) return fail("The x range is empty. Use x: -10..10.");

  return { ok: true, spec };
}

/** Values for the parameters a curve reads, from the declared sliders. */
export function scopeFrom(
  params: Map<string, ParamSpec>,
  needed: string[],
): Record<string, number> {
  const scope: Record<string, number> = {};
  for (const name of needed) {
    scope[name] = params.get(name)?.value ?? defaultParam(name).value;
  }
  return scope;
}

/** "a = 1..4" (slider) or "a = 2" (fixed). Null when the line is not one. */
function parseParam(body: string): ParamSpec | null {
  const match = /^([a-z])\s*=\s*(.+)$/i.exec(body.trim());
  if (!match) return null;
  const name = match[1].toLowerCase();
  const value = match[2].trim();

  const range = parseRange(value);
  if (range) {
    const [min, max] = range;
    return { name, min, max, value: (min + max) / 2, step: niceStep(min, max) };
  }

  const single = constant(value);
  if (single === null) return null;
  // A fixed value becomes a zero-width slider the UI shows as a number.
  return { name, min: single, max: single, value: single, step: 1 };
}

/**
 * "a = 1..4" declares a slider, and `a = 2` pins a value. Both are lines whose
 * left side is a bare parameter letter; anything with an expression on the
 * right (or a reserved name like x/y/e) is a curve and must not be swallowed.
 */
function isParamLine(body: string): boolean {
  const match = /^([a-z])\s*=\s*(.+)$/i.exec(body.trim());
  if (!match) return false;
  const name = match[1].toLowerCase();
  if (name === "y" || isReservedName(name)) return false;
  const value = match[2].trim();
  return parseRange(value) !== null || constant(value) !== null;
}

function defaultParam(name: string): ParamSpec {
  return { name, min: -5, max: 5, value: 1, step: 0.1 };
}

function niceStep(min: number, max: number): number {
  const span = Math.abs(max - min);
  if (span <= 0.2) return 0.01;
  if (span <= 2) return 0.05;
  if (span <= 20) return 0.1;
  return 0.5;
}

/** "x: -2, -1, 0 | y: 4, 1, 0" into sample points. */
function parseTable(rest: string, color: string, options: Options): TableSpec | null {
  const xPart = /x\s*:\s*([^|]+)/i.exec(rest);
  const yPart = /y\s*:\s*([^|]+)/i.exec(rest);
  if (!xPart || !yPart) return null;

  const xs = xPart[1].split(",").map((v) => constant(v.trim()));
  const ys = yPart[1].split(",").map((v) => constant(v.trim()));
  if (xs.length !== ys.length || xs.length === 0) return null;

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === null || y === null) return null;
    points.push({ x, y });
  }
  return { points, color, label: options.label, connect: options.connect ?? false };
}

function fail(error: string): GraphParse {
  return { ok: false, error };
}

function splitOnce(line: string, separator: string): string[] {
  const at = line.indexOf(separator);
  if (at === -1) return [line];
  return [line.slice(0, at), line.slice(at + separator.length)];
}

function parseOptions(raw: string): Options {
  const options: Options = {};
  if (!raw.trim()) return options;

  for (const part of raw.split(",")) {
    const [key, ...valueParts] = splitOnce(part, ":");
    const name = key.trim().toLowerCase();
    const value = valueParts.join(":").trim();

    if (name === "color" || name === "colour") options.color = normaliseColor(value);
    else if (name === "label") options.label = value;
    else if (name === "dashed" || name === "dash") options.dashed = true;
    else if (name === "connect") options.connect = true;
  }
  return options;
}

/**
 * Accepts a hex colour, but rejects anything so dark it would be invisible on
 * the near-black canvas. Models often reach for "#000000" without thinking.
 */
function normaliseColor(value: string): string | undefined {
  const hex = value.replace(/^#?/, "#");
  if (!/^#[0-9a-f]{3,8}$/i.test(hex)) return undefined;

  const rgb = hex.length === 4 ? hex.slice(1).split("").map((c) => parseInt(c + c, 16)) : null;
  const long = hex.length >= 7 ? hex.slice(1, 7) : null;
  const [r, g, b] = rgb ?? (long ? [0, 2, 4].map((i) => parseInt(long.slice(i, i + 2), 16)) : [255, 255, 255]);

  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.18 ? undefined : hex;
}

/** Endpoints may be expressions: `-2pi..2pi`, `-10..10`, `0..tau`. */
function parseRange(raw: string): [number, number] | null {
  const parts = raw.split(/\s*\.\.\s*/);
  if (parts.length !== 2) return null;
  const a = constant(parts[0]);
  const b = constant(parts[1]);
  if (a === null || b === null || b <= a) return null;
  return [a, b];
}

/** Evaluates a constant expression, returning null if it depends on x. */
const constant = evalConstant;
