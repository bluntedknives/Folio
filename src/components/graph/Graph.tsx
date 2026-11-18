"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Coordinates,
  Line,
  Mafs,
  Plot,
  Point,
  Polyline,
  Text,
  useTransformContext,
  vec,
} from "mafs";
import { parseGraphSpec, type GraphSpec, type ParamSpec, type PlotSpec } from "@/lib/graph/spec";

const HEIGHT = 360;

interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export function Graph({ source }: { source: string }) {
  const parsed = useMemo(() => parseGraphSpec(source), [source]);

  if (!parsed.ok) {
    return (
      <div className="graph-shell">
        <div className="graph-head">
          <span className="graph-lang">graph</span>
        </div>
        <p className="graph-error">{parsed.error}</p>
      </div>
    );
  }

  return <GraphCanvas spec={parsed.spec} />;
}

/**
 * The renderer is Mafs (mafs.dev): adaptive curve sampling, a squared-up
 * coordinate space, gridline panes, haloed tick labels and pointer pan/zoom all
 * come from the library, so the plot behaves like a graphing calculator rather
 * than a static picture. Everything the app's spec already understood — curves,
 * points, lines, tables, labels, sliders — maps onto Mafs primitives.
 */
export function GraphCanvas({ spec }: { spec: GraphSpec }) {
  // Reset derived state whenever the curves change, so a freshly streamed graph
  // starts from its declared defaults rather than the previous graph's sliders.
  const plotKey = `${spec.plots.map((p) => p.expr).join("|")}::${spec.xMin}::${spec.xMax}::${spec.yMin}::${spec.yMax}`;
  const [paramState, setParamState] = useState<{ key: string; values: Record<string, number> }>(
    () => ({ key: plotKey, values: initialValues(spec) }),
  );
  if (paramState.key !== plotKey) {
    setParamState({ key: plotKey, values: initialValues(spec) });
  }
  const scope = paramState.values;

  const bounds = useMemo(() => computeBounds(spec, scope), [plotKey, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const viewBox = useMemo(
    () => ({
      x: [bounds.xMin, bounds.xMax] as vec.Vector2,
      y: [bounds.yMin, bounds.yMax] as vec.Vector2,
    }),
    [bounds],
  );

  // Mafs owns its camera, so "Reset view" remounts it rather than reaching in.
  const [resetNonce, setResetNonce] = useState(0);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const viewMatrix = useRef<vec.Matrix | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);

  const reportTransform = useCallback((matrix: vec.Matrix) => {
    viewMatrix.current = matrix;
  }, []);

  // Stable per-curve functions: a fresh closure each render would resample
  // every curve on every pointer move.
  const curves = useMemo(
    () => spec.plots.map((plot) => ({ plot, y: (x: number) => plot.compiled(x, scope) })),
    [spec.plots, scope],
  );

  /** Maps a pointer position onto the maths plane through Mafs' own transform. */
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const svg = plotRef.current?.querySelector("svg");
    const matrix = viewMatrix.current;
    if (!svg || !matrix) return;
    const inverse = vec.matrixInvert(matrix);
    const ctm = svg.getScreenCTM();
    if (!inverse || !ctm) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const user = point.matrixTransform(ctm.inverse());
    const [x] = vec.transform([user.x, user.y], inverse);
    setHoverX(x);
  }

  const hoverReadout =
    hoverX === null
      ? []
      : spec.plots
          .map((plot) => {
            const y = plot.compiled(hoverX, scope);
            return Number.isFinite(y) ? { plot, y } : null;
          })
          .filter((v): v is { plot: PlotSpec; y: number } => v !== null);

  const sliders = spec.params.filter((p) => p.max > p.min);
  const hasLegend = spec.plots.some((p) => p.label) || sliders.length > 0;

  // One step for both axes keeps the cells square, which is what makes a
  // calculator grid read as a calculator grid.
  const step = useMemo(
    () => niceStep(Math.max(bounds.xMax - bounds.xMin, bounds.yMax - bounds.yMin), 9),
    [bounds],
  );

  return (
    <div className="graph-shell">
      <div className="graph-head">
        <span className="graph-lang">{spec.title ?? "graph"}</span>
        <div className="graph-head-actions">
          <button type="button" onClick={() => setResetNonce((n) => n + 1)} className="graph-reset">
            Reset view
          </button>
        </div>
      </div>

      <div
        ref={plotRef}
        className="graph-plot"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHoverX(null)}
        role="img"
        aria-label={spec.title ? `Graph of ${spec.title}` : "Graph"}
      >
        <Mafs
          key={`${plotKey}::${resetNonce}`}
          height={HEIGHT}
          viewBox={viewBox}
          preserveAspectRatio="contain"
          pan
          zoom
        >
          <Coordinates.Cartesian xAxis={{ lines: step }} yAxis={{ lines: step }} subdivisions={2} />
          <TransformReporter onChange={reportTransform} />

          {spec.lines.map((line, i) => (
            <Line.ThroughPoints
              key={`l${i}`}
              point1={line.axis === "v" ? [line.value, 0] : [0, line.value]}
              point2={line.axis === "v" ? [line.value, 1] : [1, line.value]}
              color={line.color}
              style="dashed"
              weight={1.25}
            />
          ))}

          {curves.map(({ plot, y }, i) => (
            <Plot.OfX
              key={`p${i}`}
              y={y}
              color={plot.color}
              style={plot.dashed ? "dashed" : "solid"}
              weight={2}
            />
          ))}

          {spec.tables.map((table, i) => (
            <g key={`tb${i}`}>
              {table.connect && table.points.length > 1 && (
                <Polyline
                  points={table.points.map((p) => [p.x, p.y] as vec.Vector2)}
                  color={table.color}
                  weight={1.5}
                  strokeOpacity={0.7}
                />
              )}
              {table.points.map((p, j) => (
                <Point
                  key={j}
                  x={p.x}
                  y={p.y}
                  color={table.color}
                  svgCircleProps={{ r: 3.4, stroke: "var(--graph-paper)", strokeWidth: 1.4 }}
                />
              ))}
            </g>
          ))}

          {spec.points.map((point, i) => (
            <g key={`pt${i}`}>
              <Point
                x={point.x}
                y={point.y}
                color={point.color}
                svgCircleProps={{ r: 4.2, stroke: "var(--graph-paper)", strokeWidth: 1.6 }}
              />
              {point.label && (
                <Text x={point.x} y={point.y} attach="ne" attachDistance={11} size={12} color={point.color}>
                  {point.label}
                </Text>
              )}
            </g>
          ))}

          {hoverX !== null && (
            <g>
              <Line.ThroughPoints
                point1={[hoverX, 0]}
                point2={[hoverX, 1]}
                color="var(--graph-axis)"
                style="dashed"
                weight={1}
              />
              {hoverReadout.map(({ plot, y }, i) => (
                <Point
                  key={`hp${i}`}
                  x={hoverX}
                  y={y}
                  color={plot.color}
                  svgCircleProps={{ r: 3.4, stroke: "var(--graph-paper)", strokeWidth: 1.2 }}
                />
              ))}
            </g>
          )}
        </Mafs>

        <span className="graph-axis-name graph-axis-x" aria-hidden>
          x
        </span>
        <span className="graph-axis-name graph-axis-y" aria-hidden>
          y
        </span>
      </div>

      {sliders.length > 0 && (
        <div className="graph-sliders">
          {sliders.map((param) => (
            <Slider
              key={param.name}
              param={param}
              value={scope[param.name] ?? param.value}
              color={colorFor(spec, param.name)}
              onChange={(next) =>
                setParamState((prev) => ({ key: prev.key, values: { ...prev.values, [param.name]: next } }))
              }
            />
          ))}
        </div>
      )}

      {(hasLegend || hoverReadout.length > 0) && (
        <div className="graph-foot">
          {hoverReadout.length > 0 ? (
            hoverReadout.map(({ plot, y }, i) => (
              <span key={i} className="graph-readout">
                <span className="graph-swatch" style={{ background: plot.color }} />
                {plot.label ? `${plot.label} ` : ""}({formatTick(hoverX ?? 0)}, {formatTick(y)})
              </span>
            ))
          ) : (
            spec.plots
              .filter((p) => p.label)
              .map((p, i) => (
                <span key={i} className="graph-readout">
                  <span className="graph-swatch" style={{ background: p.color }} />
                  {p.label}
                </span>
              ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Mafs keeps its view transform in context, but the hover readout lives in the
 * wrapper outside it. This child hands the matrix out so the wrapper can invert
 * a pointer position back into maths coordinates.
 */
function TransformReporter({ onChange }: { onChange: (matrix: vec.Matrix) => void }) {
  const { viewTransform } = useTransformContext();
  useEffect(() => {
    onChange(viewTransform);
  }, [viewTransform, onChange]);
  return null;
}

/** One parameter slider, coloured to match the curves that use it. */
function Slider({
  param,
  value,
  color,
  onChange,
}: {
  param: ParamSpec;
  value: number;
  color: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="graph-slider">
      <span className="graph-slider-name" style={{ color }}>
        {param.name}
      </span>
      <input
        type="range"
        min={param.min}
        max={param.max}
        step={param.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`Value of ${param.name}`}
        style={{ color }}
        className="graph-range"
      />
      <span className="graph-slider-value">{formatTick(value)}</span>
    </label>
  );
}

/** The colour of the first curve that reads a parameter, for the slider tint. */
function colorFor(spec: GraphSpec, name: string): string {
  return spec.plots.find((p) => p.params.includes(name))?.color ?? "var(--ink-600)";
}

function initialValues(spec: GraphSpec): Record<string, number> {
  const values: Record<string, number> = {};
  for (const param of spec.params) values[param.name] = param.value;
  return values;
}

/**
 * Chooses the window. An explicit y is honoured. Otherwise the window is
 * square and fitted to the data: Mafs draws on square units, so a window whose
 * height does not match its width is widened by the library, and a tall curve
 * against a short window would then be shrunk to nothing. Fitting the square to
 * the union of the requested x span and the curve's own y span keeps the curve
 * whole — a parabola whose arms run off the top is clipped, exactly as it is on
 * a graphing calculator, instead of being squashed to fit.
 */
function computeBounds(spec: GraphSpec, scope: Record<string, number>): Bounds {
  if (spec.yMin !== undefined && spec.yMax !== undefined) {
    return { xMin: spec.xMin, xMax: spec.xMax, yMin: spec.yMin, yMax: spec.yMax };
  }

  const ys: number[] = [];
  for (const plot of spec.plots) {
    for (let i = 0; i <= 400; i++) {
      const x = spec.xMin + ((spec.xMax - spec.xMin) * i) / 400;
      const y = plot.compiled(x, scope);
      if (Number.isFinite(y)) ys.push(y);
    }
  }
  for (const table of spec.tables) for (const p of table.points) ys.push(p.y);
  for (const point of spec.points) ys.push(point.y);
  for (const line of spec.lines) if (line.axis === "h") ys.push(line.value);

  const xSpan = spec.xMax - spec.xMin;
  const xMid = (spec.xMin + spec.xMax) / 2;

  if (ys.length === 0) {
    const half = xSpan / 2;
    return { xMin: spec.xMin, xMax: spec.xMax, yMin: -half, yMax: half };
  }

  ys.sort((a, b) => a - b);
  const quantile = (p: number) => ys[Math.min(ys.length - 1, Math.max(0, Math.round(p * (ys.length - 1))))];
  const lo = quantile(0.02);
  const hi = quantile(0.98);

  // Centre on the origin when the data spans it, so the axes stay in view.
  const yMid = lo <= 0 && hi >= 0 ? 0 : (lo + hi) / 2;
  const half = Math.max(xSpan, (hi - lo) * 1.1) / 2;
  return { xMin: xMid - half, xMax: xMid + half, yMin: yMid - half, yMax: yMid + half };
}

/** The 1/2/5 x 10^n step that best fits `span` into about `count` divisions. */
function niceStep(span: number, count: number): number {
  const rough = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  const factor = normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1;
  return factor * magnitude;
}

function formatTick(value: number): string {
  if (Math.abs(value) >= 10000 || (Math.abs(value) < 0.01 && value !== 0)) {
    return value.toExponential(1);
  }
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}
