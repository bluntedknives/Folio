"use client";

import type { GraphSpec } from "@/lib/graph/spec";
import { toDesmosLatex } from "@/lib/math/expression";

/**
 * Thin wrapper around the Desmos Graphing Calculator API.
 *
 * The script is roughly 4 MB, so it is only fetched the first time a graph is
 * actually rendered with Desmos turned on, never on page load. Everything is
 * best-effort: if the script cannot load, the caller keeps the local plotter.
 *
 * The API key below is Desmos' public trial key, which they hand out for
 * prototyping. It is not a secret. For a production deployment, request a key
 * at https://www.desmos.com/api and put it in NEXT_PUBLIC_DESMOS_API_KEY.
 */

const SCRIPT_ID = "desmos-api-script";
const API_VERSION = "v1.11";
const TRIAL_KEY = "dcb31709b452b1cf9dc26972add0fda6";

const API_KEY = process.env.NEXT_PUBLIC_DESMOS_API_KEY || TRIAL_KEY;

/** The subset of the Desmos API we touch. */
interface DesmosExpression {
  id?: string;
  latex?: string;
  color?: string;
  lineStyle?: "SOLID" | "DASHED" | "DOTTED";
  hidden?: boolean;
  points?: boolean;
  lines?: boolean;
  sliderBounds?: { min: string; max: string; step?: string };
  showLabel?: boolean;
  label?: string;
}

interface DesmosCalculator {
  setExpression: (expression: DesmosExpression) => void;
  removeExpression: (expression: { id: string }) => void;
  setBlank: () => void;
  setMathBounds: (bounds: { left: number; right: number; bottom: number; top: number }) => void;
  updateSettings: (settings: Record<string, unknown>) => void;
  getExpressions: () => DesmosExpression[];
  observe: (event: string, handler: () => void) => void;
  unobserve: (event: string, handler: () => void) => void;
  destroy: () => void;
  resize: () => void;
}

interface DesmosGlobal {
  GraphingCalculator: (
    element: HTMLElement,
    options?: Record<string, unknown>,
  ) => DesmosCalculator;
}

declare global {
  interface Window {
    Desmos?: DesmosGlobal;
  }
}

let loader: Promise<DesmosGlobal> | null = null;

/** Loads the Desmos script once and resolves with the global. */
export function loadDesmos(): Promise<DesmosGlobal> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.Desmos) return Promise.resolve(window.Desmos);
  if (loader) return loader;

  loader = new Promise<DesmosGlobal>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const timer = window.setTimeout(() => reject(new Error("Desmos timed out")), 20000);

    const done = () => {
      window.clearTimeout(timer);
      if (window.Desmos) resolve(window.Desmos);
      else reject(new Error("Desmos did not initialise"));
    };

    if (existing) {
      // A script tag is already there; wait for it rather than adding another.
      script.addEventListener("load", done, { once: true });
      script.addEventListener("error", () => reject(new Error("Desmos failed to load")), {
        once: true,
      });
      return;
    }

    script.id = SCRIPT_ID;
    script.src = `https://www.desmos.com/api/${API_VERSION}/calculator.js?apiKey=${API_KEY}`;
    script.async = true;
    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", () => {
      window.clearTimeout(timer);
      loader = null;
      reject(new Error("Desmos failed to load"));
    });
    document.head.append(script);
  });

  return loader;
}

/** A live Desmos calculator we can update without remounting. */
export interface DesmosHandle {
  dispose: () => void;
  setDark: (dark: boolean) => void;
}

/**
 * Creates a calculator bound to `element` and pushes `spec` into it.
 */
export async function mountDesmos(
  element: HTMLElement,
  spec: GraphSpec,
  options: { dark: boolean },
): Promise<DesmosHandle> {
  const desmos = await loadDesmos();
  const optionsFor = (dark: boolean) => ({
    expressions: true,
    settingsMenu: false,
    zoomButtons: true,
    // Desmos draws on its own canvas, so the theme has to be passed in rather
    // than inherited from CSS.
    invertedColors: dark,
    backgroundColor: dark ? "#0e1012" : "#ffffff",
    border: false,
    keypad: false,
    expressionsCollapsed: true,
  });

  const calculator = desmos.GraphingCalculator(element, optionsFor(options.dark));
  applySpec(calculator, spec);
  calculator.setMathBounds({
    left: spec.xMin,
    right: spec.xMax,
    bottom: spec.yMin ?? -10,
    top: spec.yMax ?? 10,
  });

  return {
    dispose: () => {
      try {
        calculator.destroy();
      } catch {
        /* already torn down */
      }
    },
    setDark: (dark) => {
      // `updateSettings` re-reads the colour options without a full rebuild.
      calculator.updateSettings(optionsFor(dark));
    },
  };
}

/** Replaces every expression in the calculator with the ones from `spec`. */
export function applySpec(calculator: DesmosCalculator, spec: GraphSpec): void {
  calculator.setBlank();

  spec.plots.forEach((plot, index) => {
    const latex = toDesmosLatex(plot.expr);
    if (!latex) return;
    calculator.setExpression({
      id: `curve-${index}`,
      latex: `y=${latex}`,
      color: cssColour(plot.color),
      lineStyle: plot.dashed ? "DASHED" : "SOLID",
      showLabel: Boolean(plot.label),
      label: plot.label,
    });
  });

  spec.params.forEach((param, index) => {
    calculator.setExpression({
      id: `param-${index}`,
      latex: `${param.name}=${param.value}`,
      sliderBounds: {
        min: String(param.min),
        max: String(param.max),
        step: String(param.step),
      },
      showLabel: false,
    });
  });

  spec.points.forEach((point, index) => {
    calculator.setExpression({
      id: `point-${index}`,
      latex: `(${point.x},${point.y})`,
      color: cssColour(point.color),
      showLabel: Boolean(point.label),
      label: point.label,
    });
  });

  spec.lines.forEach((line, index) => {
    calculator.setExpression({
      id: `line-${index}`,
      latex: line.axis === "v" ? `x=${line.value}` : `y=${line.value}`,
      color: cssColour(line.color),
      lineStyle: "DASHED",
    });
  });

  spec.tables.forEach((table, index) => {
    if (table.points.length === 0) return;
    calculator.setExpression({
      id: `table-${index}`,
      latex: `\\left(${table.points.map((p) => `(${p.x},${p.y})`).join(",")}\\right)`,
      color: cssColour(table.color),
      points: true,
      lines: table.connect,
    });
  });
}


/**
 * Desmos wants a concrete colour, but our palette holds CSS variables. Reads
 * the resolved value from the document, falling back to a mid grey.
 */
function cssColour(value: string): string {
  if (!value.startsWith("var(")) return value;
  const name = value.slice(4, -1).trim();
  if (typeof window === "undefined") return "#4a5056";
  const resolved = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return resolved || "#4a5056";
}
