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
 *   y = x^2 - 2x + 1
 *   y = 2x + 1 | color: #7aa2f7, dashed
 *   point (1, 0) | label: vertex
 *   line y = 3
 *
 * Only expressions that `compileExpression` accepts will ever run.
 */

import { compileExpression, evalConstant, type Compiled } from "../math/expression";

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

export interface GraphSpec {
  title?: string;
  xMin: number;
  xMax: number;
  yMin?: number;
  yMax?: number;
  plots: PlotSpec[];
  points: PointSpec[];
  lines: LineSpec[];
}

export type GraphParse = { ok: true; spec: GraphSpec } | { ok: false; error: string };

interface Options {
  color?: string;
  label?: string;
  dashed?: boolean;
}

export function parseGraphSpec(source: string): GraphParse {
  const lines = source.split("\n");
  const spec: GraphSpec = { xMin: -10, xMax: 10, plots: [], points: [], lines: [] };
  let nextColor = 0;
  const takeColor = (explicit?: string) => explicit ?? PALETTE[nextColor++ % PALETTE.length];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const [body, ...optionParts] = splitOnce(line, "|");
    const options = parseOptions(optionParts.join("|"));
    const lower = body.toLowerCase();

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
        color: options.color ?? "#4a5056",
        label: options.label,
      });
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

    // Verify it produces at least one finite value so we never render a blank card.
    let anyFinite = false;
    for (let i = 0; i <= 40; i++) {
      const x = spec.xMin + ((spec.xMax - spec.xMin) * i) / 40;
      if (Number.isFinite(compiled(x))) {
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
    });
  }

  if (spec.plots.length === 0 && spec.points.length === 0 && spec.lines.length === 0) {
    return fail("A graph needs at least one curve, point or line.");
  }
  if (spec.xMax <= spec.xMin) return fail("The x range is empty. Use x: -10..10.");

  return { ok: true, spec };
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
