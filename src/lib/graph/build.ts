/**
 * Turns a plain list of plot inputs (what the custom plotter collects from its
 * fields) into the same GraphSpec the model's ```graph block produces. Keeping
 * one spec type means the renderer, the parser and the plotter cannot drift.
 */

import { compileExpression } from "../math/expression";
import { PALETTE, type GraphParse, type GraphSpec } from "./spec";

export interface PlotInput {
  /** Right-hand side only, e.g. "x^2 - 2x + 1" or "sin(x)". */
  expr: string;
  color?: string;
  label?: string;
}

export interface GraphInput {
  title?: string;
  xMin: number;
  xMax: number;
  yMin?: number;
  yMax?: number;
  plots: PlotInput[];
}

export function buildGraphSpec(input: GraphInput): GraphParse {
  if (!(input.xMax > input.xMin)) {
    return { ok: false, error: "The x range is empty. Set a start below the end." };
  }
  if (input.yMin !== undefined && input.yMax !== undefined && !(input.yMax > input.yMin)) {
    return { ok: false, error: "The y range is empty. Set a start below the end." };
  }

  const spec: GraphSpec = {
    title: input.title?.trim() || undefined,
    xMin: input.xMin,
    xMax: input.xMax,
    yMin: input.yMin,
    yMax: input.yMax,
    plots: [],
    points: [],
    lines: [],
  };

  let colourIndex = 0;
  for (const plot of input.plots) {
    const expr = plot.expr.trim();
    if (!expr) continue;

    let compiled;
    try {
      compiled = compileExpression(expr);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }

    let anyFinite = false;
    for (let i = 0; i <= 40; i++) {
      const x = spec.xMin + ((spec.xMax - spec.xMin) * i) / 40;
      if (Number.isFinite(compiled(x))) {
        anyFinite = true;
        break;
      }
    }
    if (!anyFinite) {
      return { ok: false, error: `"${expr}" has no finite values in this range.` };
    }

    spec.plots.push({
      expr,
      compiled,
      color: plot.color ?? PALETTE[colourIndex++ % PALETTE.length],
      label: plot.label?.trim() || undefined,
    });
  }

  if (spec.plots.length === 0) {
    return { ok: false, error: "Add at least one curve to plot." };
  }

  return { ok: true, spec };
}

/** Serialises a plotter state back into a ```graph block for the chat. */
export function toGraphFence(spec: GraphSpec): string {
  const lines = ["```graph"];
  if (spec.title) lines.push(`title: ${spec.title}`);
  lines.push(`x: ${trim(spec.xMin)}..${trim(spec.xMax)}`);
  if (spec.yMin !== undefined && spec.yMax !== undefined) {
    lines.push(`y: ${trim(spec.yMin)}..${trim(spec.yMax)}`);
  }
  for (const plot of spec.plots) {
    const options = [
      plot.label ? `label: ${plot.label}` : "",
      plot.color ? `color: ${plot.color}` : "",
    ].filter(Boolean);
    lines.push(`y = ${plot.expr}${options.length ? ` | ${options.join(", ")}` : ""}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function trim(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}
