"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { parseGraphSpec, type GraphSpec, type ParamSpec, type PlotSpec } from "@/lib/graph/spec";

const WIDTH = 640;
const HEIGHT = 400;
const PAD = { top: 16, right: 18, bottom: 26, left: 34 };
const SAMPLES = 900;

/** Plot area in viewBox units. */
const PLOT = {
  x0: PAD.left,
  x1: WIDTH - PAD.right,
  y0: PAD.top,
  y1: HEIGHT - PAD.bottom,
};

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

export function GraphCanvas({ spec }: { spec: GraphSpec }) {
  const [hoverX, setHoverX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; bounds: Bounds } | null>(null);
  // Each instance needs its own clip path id: two graphs on one page would
  // otherwise share the first one and clip against the wrong rectangle.
  const clipId = `plot-clip-${useId().replace(/:/g, "")}`;

  // Slider values, keyed by parameter name. Reset whenever the curves change so
  // a freshly streamed graph starts from its declared defaults.
  const plotKey = `${spec.plots.map((p) => p.expr).join("|")}::${spec.xMin}::${spec.xMax}::${spec.yMin}::${spec.yMax}`;
  const [paramState, setParamState] = useState<{ key: string; values: Record<string, number> }>(
    () => ({ key: plotKey, values: initialValues(spec) }),
  );
  if (paramState.key !== plotKey) {
    setParamState({ key: plotKey, values: initialValues(spec) });
  }
  const scope = paramState.values;

  const baseBounds = useMemo(() => computeBounds(spec, scope), [plotKey, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the viewport when the underlying curves change (derived state, so it
  // happens during render rather than in an effect).
  const [viewState, setViewState] = useState({ key: plotKey, bounds: baseBounds });
  if (viewState.key !== plotKey) setViewState({ key: plotKey, bounds: baseBounds });

  const view = viewState.bounds;
  const setBounds = (next: Bounds) => setViewState({ key: plotKey, bounds: next });

  const toX = useCallback(
    (x: number) => PLOT.x0 + ((x - view.xMin) / (view.xMax - view.xMin)) * (PLOT.x1 - PLOT.x0),
    [view],
  );
  const toY = useCallback(
    (y: number) => PLOT.y1 - ((y - view.yMin) / (view.yMax - view.yMin)) * (PLOT.y1 - PLOT.y0),
    [view],
  );

  const paths = useMemo(
    () => spec.plots.map((plot) => ({ plot, d: buildPath(plot, view, scope) })),
    [spec.plots, view, scope],
  );

  const xTicks = useMemo(() => ticks(view.xMin, view.xMax), [view.xMin, view.xMax]);
  const yTicks = useMemo(() => ticks(view.yMin, view.yMax), [view.yMin, view.yMax]);

  /** Zooms about a data point, which is what the wheel should feel like. */
  function zoomAt(factor: number, cx: number, cy: number) {
    setBounds(zoom(view, factor, cx, cy));
  }

  function onWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    let cx = view.xMin + (view.xMax - view.xMin) / 2;
    let cy = view.yMin + (view.yMax - view.yMin) / 2;
    if (rect) {
      // Zoom about the pointer, like Desmos.
      const px = ((event.clientX - rect.left) / rect.width) * WIDTH;
      const py = ((event.clientY - rect.top) / rect.height) * HEIGHT;
      cx = view.xMin + ((px - PLOT.x0) / (PLOT.x1 - PLOT.x0)) * (view.xMax - view.xMin);
      cy = view.yMin + ((PLOT.y1 - py) / (PLOT.y1 - PLOT.y0)) * (view.yMax - view.yMin);
    }
    zoomAt(event.deltaY > 0 ? 1.12 : 0.89, cx, cy);
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    drag.current = { x: event.clientX, y: event.clientY, bounds: view };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (rect) {
      const px = ((event.clientX - rect.left) / rect.width) * WIDTH;
      const dataX = view.xMin + ((px - PLOT.x0) / (PLOT.x1 - PLOT.x0)) * (view.xMax - view.xMin);
      setHoverX(dataX >= view.xMin && dataX <= view.xMax ? dataX : null);
    }

    const state = drag.current;
    if (!state || !rect) return;
    const dx = ((event.clientX - state.x) / rect.width) * (state.bounds.xMax - state.bounds.xMin);
    const dy = ((event.clientY - state.y) / rect.height) * (state.bounds.yMax - state.bounds.yMin);
    setBounds({
      xMin: state.bounds.xMin - dx,
      xMax: state.bounds.xMax - dx,
      yMin: state.bounds.yMin + dy,
      yMax: state.bounds.yMax + dy,
    });
  }

  function endDrag(event: React.PointerEvent<SVGSVGElement>) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onPointerLeave(event: React.PointerEvent<SVGSVGElement>) {
    endDrag(event);
    setHoverX(null);
  }

  const hoverReadout =
    hoverX === null
      ? null
      : spec.plots
          .map((plot) => {
            const y = plot.compiled(hoverX, scope);
            return Number.isFinite(y) ? { plot, y } : null;
          })
          .filter((v): v is { plot: PlotSpec; y: number } => v !== null);

  const sliders = spec.params.filter((p) => p.max > p.min);
  const hasLegend = spec.plots.some((p) => p.label) || sliders.length > 0;

  return (
    <div className="graph-shell">
      <div className="graph-head">
        <span className="graph-lang">{spec.title ?? "graph"}</span>
        <div className="graph-head-actions">
          <button type="button" onClick={() => setBounds(baseBounds)} className="graph-reset">
            Reset view
          </button>
        </div>
      </div>

            <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="graph-svg"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={onPointerLeave}
        role="img"
        aria-label={spec.title ? `Graph of ${spec.title}` : "Graph"}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PLOT.x0} y={PLOT.y0} width={PLOT.x1 - PLOT.x0} height={PLOT.y1 - PLOT.y0} />
          </clipPath>
        </defs>

        <rect
          x={PLOT.x0}
          y={PLOT.y0}
          width={PLOT.x1 - PLOT.x0}
          height={PLOT.y1 - PLOT.y0}
          fill="var(--graph-paper)"
        />

        {/* Minor gridlines first, then the major ones over them, so the eye
            reads the labelled lines as the structure. */}
        <g clipPath={`url(#${clipId})`}>
          {minorTicks(view.xMin, view.xMax, xTicks).map((t) => (
            <line key={`mx${t}`} x1={toX(t)} x2={toX(t)} y1={PLOT.y0} y2={PLOT.y1} stroke="var(--graph-grid-minor)" />
          ))}
          {minorTicks(view.yMin, view.yMax, yTicks).map((t) => (
            <line key={`my${t}`} x1={PLOT.x0} x2={PLOT.x1} y1={toY(t)} y2={toY(t)} stroke="var(--graph-grid-minor)" />
          ))}
          {xTicks.map((t) => (
            <line key={`gx${t}`} x1={toX(t)} x2={toX(t)} y1={PLOT.y0} y2={PLOT.y1} stroke="var(--graph-grid)" />
          ))}
          {yTicks.map((t) => (
            <line key={`gy${t}`} x1={PLOT.x0} x2={PLOT.x1} y1={toY(t)} y2={toY(t)} stroke="var(--graph-grid)" />
          ))}

          {/* The axes are pinned to the edges when the origin is off-screen, so
              the numbers always have a line to sit against, as Desmos does. */}
          {axisLines(view).map((axis) => (
            <g key={axis.key}>
              <line
                x1={axis.x1}
                y1={axis.y1}
                x2={axis.x2}
                y2={axis.y2}
                stroke="var(--graph-axis)"
                strokeWidth={1.4}
              />
              {axis.arrow && (
                <path d={axis.arrow} fill="var(--graph-axis)" />
              )}
            </g>
          ))}

          {spec.lines.map((line, i) =>
            line.axis === "v" ? (
              <line key={`l${i}`} x1={toX(line.value)} x2={toX(line.value)} y1={PLOT.y0} y2={PLOT.y1} stroke={line.color} strokeWidth={1.25} strokeDasharray="5 4" />
            ) : (
              <line key={`l${i}`} x1={PLOT.x0} x2={PLOT.x1} y1={toY(line.value)} y2={toY(line.value)} stroke={line.color} strokeWidth={1.25} strokeDasharray="5 4" />
            ),
          )}

          {paths.map(({ plot, d }, i) => (
            <path
              key={`p${i}`}
              d={d}
              fill="none"
              stroke={plot.color}
              strokeWidth={2.1}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={plot.dashed ? "6 4" : undefined}
            />
          ))}

          {spec.tables.map((table, i) => (
            <g key={`tb${i}`}>
              {table.connect && table.points.length > 1 && (
                <polyline
                  points={table.points.map((p) => `${toX(p.x)},${toY(p.y)}`).join(" ")}
                  fill="none"
                  stroke={table.color}
                  strokeWidth={1.5}
                  opacity={0.7}
                />
              )}
              {table.points.map((p, j) => (
                <circle
                  key={j}
                  cx={toX(p.x)}
                  cy={toY(p.y)}
                  r={3.4}
                  fill={table.color}
                  stroke="var(--graph-paper)"
                  strokeWidth={1.4}
                />
              ))}
            </g>
          ))}

          {spec.points.map((point, i) => (
            <g key={`pt${i}`}>
              <circle cx={toX(point.x)} cy={toY(point.y)} r={4.2} fill={point.color} stroke="var(--graph-paper)" strokeWidth={1.6} />
              {point.label && (
                <text x={toX(point.x) + 8} y={toY(point.y) - 7} className="graph-label" fill={point.color}>
                  {point.label}
                </text>
              )}
            </g>
          ))}

          {hoverX !== null && (
            <line x1={toX(hoverX)} x2={toX(hoverX)} y1={PLOT.y0} y2={PLOT.y1} stroke="var(--graph-axis)" strokeDasharray="3 3" />
          )}
          {hoverX !== null &&
            hoverReadout?.map(({ plot, y }, i) => (
              <circle key={`hp${i}`} cx={toX(hoverX)} cy={toY(y)} r={3.4} fill={plot.color} stroke="var(--graph-paper)" strokeWidth={1.2} />
            ))}
        </g>

        {/* Tick numbers sit in the gutter, so they never collide with a curve. */}
        {xTicks.map((t) => (
          <text key={`tx${t}`} x={toX(t)} y={HEIGHT - 8} className="graph-tick" textAnchor="middle">
            {formatTick(t)}
          </text>
        ))}
        {yTicks.map((t) => (
          <text key={`ty${t}`} x={PLOT.x0 - 7} y={toY(t) + 3.5} className="graph-tick" textAnchor="end">
            {formatTick(t)}
          </text>
        ))}
        <text x={PLOT.x1 + 1} y={toY(0) + 13} className="graph-axis-name" textAnchor="end">
          x
        </text>
        <text x={PLOT.x0 - 8} y={PLOT.y0 + 11} className="graph-axis-name" textAnchor="end">
          y
        </text>
      </svg>

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

      {(hasLegend || hoverReadout) && (
        <div className="graph-foot">
          {hoverReadout && hoverReadout.length > 0 ? (
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

/** Chooses the y window: explicit if given, otherwise a robust fit to the curves. */
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

  if (ys.length === 0) return { xMin: spec.xMin, xMax: spec.xMax, yMin: -10, yMax: 10 };

  ys.sort((a, b) => a - b);
  const quantile = (p: number) =>
    ys[Math.min(ys.length - 1, Math.max(0, Math.round(p * (ys.length - 1))))];

  let lo = quantile(0.02);
  let hi = quantile(0.98);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [ys[0], ys[ys.length - 1]];
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.08;
  return { xMin: spec.xMin, xMax: spec.xMax, yMin: lo - pad, yMax: hi + pad };
}

/**
 * Samples the curve across the viewport. Long jumps are treated as
 * discontinuities (asymptotes in tan, 1/x) and break the path so we do not
 * draw a false vertical line across the plot.
 */
function buildPath(plot: PlotSpec, view: Bounds, scope: Record<string, number>): string {
  const parts: string[] = [];
  let pen = false;
  let prevY: number | null = null;

  const px = (x: number) =>
    PLOT.x0 + ((x - view.xMin) / (view.xMax - view.xMin)) * (PLOT.x1 - PLOT.x0);
  const py = (y: number) =>
    PLOT.y1 - ((y - view.yMin) / (view.yMax - view.yMin)) * (PLOT.y1 - PLOT.y0);

  const span = view.yMax - view.yMin;
  const jumpLimit = span * 1.6;

  for (let i = 0; i <= SAMPLES; i++) {
    const x = view.xMin + ((view.xMax - view.xMin) * i) / SAMPLES;
    const y = plot.compiled(x, scope);

    if (!Number.isFinite(y)) {
      pen = false;
      prevY = null;
      continue;
    }

    const cx = px(x);
    const cy = py(y);

    if (prevY !== null && Math.abs(y - prevY) > jumpLimit) {
      pen = false;
      prevY = null;
    }

    if (!pen) {
      parts.push(`M ${round(cx)} ${round(cy)}`);
      pen = true;
    } else {
      parts.push(`L ${round(cx)} ${round(cy)}`);
    }
    prevY = y;
  }

  return parts.join(" ");
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The 1/2/5 x 10^n step that best fits `span` into about `count` divisions. */
function niceStep(span: number, count: number): number {
  const rough = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  const factor = normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1;
  return factor * magnitude;
}

/** Ticks for a range, snapped to 1/2/5 x 10^n. */
function ticksWith(min: number, max: number, step: number): number[] {
  if (!Number.isFinite(step) || step <= 0) return [];
  const out: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let t = start; t <= max + step * 1e-6 && out.length < 400; t += step) {
    out.push(Math.abs(t) < step * 1e-6 ? 0 : t);
  }
  return out;
}

/** Labelled ticks, about seven across the range. */
function ticks(min: number, max: number): number[] {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return [];
  return ticksWith(min, max, niceStep(span, 7));
}

/**
 * Unlabelled gridlines halfway between the labelled ones, which is what gives
 * a Desmos grid its texture. Skipped when the labels are already dense.
 */
function minorTicks(min: number, max: number, majors: number[]): number[] {
  if (majors.length < 2 || majors.length > 14) return [];
  const step = (majors[1] - majors[0]) / 2;
  return ticksWith(min, max, step).filter((t) => !majors.includes(t));
}

interface Axis {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Arrowhead path at the positive end, or null when the axis is clipped. */
  arrow: string | null;
}

/**
 * The x and y axes. When the origin is inside the view the axis is drawn there;
 * otherwise it is pinned to the nearest edge so the tick numbers still have a
 * line to sit against, which is what Desmos does.
 */
function axisLines(view: Bounds): Axis[] {
  const xAt = view.yMin <= 0 && view.yMax >= 0 ? toYIn(view, 0) : PLOT.y0;
  const yAt = view.xMin <= 0 && view.xMax >= 0 ? toXIn(view, 0) : PLOT.x0;
  const size = 4;
  return [
    {
      key: "x-axis",
      x1: PLOT.x0,
      y1: xAt,
      x2: PLOT.x1,
      y2: xAt,
      arrow: `M ${PLOT.x1} ${xAt} l ${-size * 1.8} ${-size} l 0 ${size * 2} z`,
    },
    {
      key: "y-axis",
      x1: yAt,
      y1: PLOT.y1,
      x2: yAt,
      y2: PLOT.y0,
      arrow: `M ${yAt} ${PLOT.y0} l ${-size} ${size * 1.8} l ${size * 2} 0 z`,
    },
  ];
}

function toXIn(view: Bounds, x: number): number {
  return PLOT.x0 + ((x - view.xMin) / (view.xMax - view.xMin)) * (PLOT.x1 - PLOT.x0);
}

function toYIn(view: Bounds, y: number): number {
  return PLOT.y1 - ((y - view.yMin) / (view.yMax - view.yMin)) * (PLOT.y1 - PLOT.y0);
}

function formatTick(value: number): string {
  if (Math.abs(value) >= 10000 || (Math.abs(value) < 0.01 && value !== 0)) {
    return value.toExponential(1);
  }
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

function zoom(view: Bounds, factor: number, cx: number, cy: number): Bounds {
  return {
    xMin: cx + (view.xMin - cx) * factor,
    xMax: cx + (view.xMax - cx) * factor,
    yMin: cy + (view.yMin - cy) * factor,
    yMax: cy + (view.yMax - cy) * factor,
  };
}
