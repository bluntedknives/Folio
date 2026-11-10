"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { parseGraphSpec, type GraphSpec, type PlotSpec } from "@/lib/graph/spec";

const WIDTH = 640;
const HEIGHT = 380;
const PAD = { top: 18, right: 20, bottom: 30, left: 40 };
const SAMPLES = 720;

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

  // Keyed on the curves themselves, not the raw text, so a partially streamed
  // block does not reset the viewport on every token.
  const plotKey = `${spec.plots.map((p) => p.expr).join("|")}::${spec.xMin}::${spec.xMax}::${spec.yMin}::${spec.yMax}`;
  const baseBounds = useMemo(() => computeBounds(spec), [plotKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
    () => spec.plots.map((plot) => ({ plot, d: buildPath(plot, view) })),
    [spec.plots, view],
  );

  const xTicks = useMemo(() => ticks(view.xMin, view.xMax), [view.xMin, view.xMax]);
  const yTicks = useMemo(() => ticks(view.yMin, view.yMax), [view.yMin, view.yMax]);

  function onWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.12 : 0.89;
    setBounds(zoom(view, factor, view.xMin + (view.xMax - view.xMin) / 2, view.yMin + (view.yMax - view.yMin) / 2));
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
            const y = plot.compiled(hoverX);
            return Number.isFinite(y) ? { plot, y } : null;
          })
          .filter((v): v is { plot: PlotSpec; y: number } => v !== null);

  return (
    <div className="graph-shell">
      <div className="graph-head">
        <span className="graph-lang">{spec.title ?? "graph"}</span>
        <button type="button" onClick={() => setBounds(baseBounds)} className="graph-reset">
          Reset view
        </button>
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

        <g clipPath={`url(#${clipId})`}>
          <rect x={PLOT.x0} y={PLOT.y0} width={PLOT.x1 - PLOT.x0} height={PLOT.y1 - PLOT.y0} fill="var(--ink-100)" />

          {xTicks.map((t) => (
            <line key={`gx${t}`} x1={toX(t)} x2={toX(t)} y1={PLOT.y0} y2={PLOT.y1} stroke="var(--stroke-faint)" />
          ))}
          {yTicks.map((t) => (
            <line key={`gy${t}`} x1={PLOT.x0} x2={PLOT.x1} y1={toY(t)} y2={toY(t)} stroke="var(--stroke-faint)" />
          ))}

          {view.yMin <= 0 && view.yMax >= 0 && (
            <line x1={PLOT.x0} x2={PLOT.x1} y1={toY(0)} y2={toY(0)} stroke="var(--stroke-strong)" />
          )}
          {view.xMin <= 0 && view.xMax >= 0 && (
            <line x1={toX(0)} x2={toX(0)} y1={PLOT.y0} y2={PLOT.y1} stroke="var(--stroke-strong)" />
          )}

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
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={plot.dashed ? "6 4" : undefined}
            />
          ))}

          {spec.points.map((point, i) => (
            <g key={`pt${i}`}>
              <circle cx={toX(point.x)} cy={toY(point.y)} r={4} fill={point.color} stroke="var(--ink-050)" strokeWidth={1.5} />
              {point.label && (
                <text x={toX(point.x) + 8} y={toY(point.y) - 7} className="graph-label" fill={point.color}>
                  {point.label}
                </text>
              )}
            </g>
          ))}

          {hoverX !== null && (
            <line x1={toX(hoverX)} x2={toX(hoverX)} y1={PLOT.y0} y2={PLOT.y1} stroke="var(--stroke-strong)" strokeDasharray="3 3" />
          )}
        </g>

        {xTicks.map((t) => (
          <text key={`tx${t}`} x={toX(t)} y={HEIGHT - 11} className="graph-tick" textAnchor="middle">
            {formatTick(t)}
          </text>
        ))}
        {yTicks.map((t) => (
          <text key={`ty${t}`} x={PLOT.x0 - 7} y={toY(t) + 3.5} className="graph-tick" textAnchor="end">
            {formatTick(t)}
          </text>
        ))}
      </svg>

      {(spec.plots.some((p) => p.label) || hoverReadout) && (
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

/** Chooses the y window: explicit if given, otherwise a robust fit to the curves. */
function computeBounds(spec: GraphSpec): Bounds {
  if (spec.yMin !== undefined && spec.yMax !== undefined) {
    return { xMin: spec.xMin, xMax: spec.xMax, yMin: spec.yMin, yMax: spec.yMax };
  }

  const ys: number[] = [];
  for (const plot of spec.plots) {
    for (let i = 0; i <= 400; i++) {
      const x = spec.xMin + ((spec.xMax - spec.xMin) * i) / 400;
      const y = plot.compiled(x);
      if (Number.isFinite(y)) ys.push(y);
    }
  }
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
function buildPath(plot: PlotSpec, view: Bounds): string {
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
    const y = plot.compiled(x);

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

/** ~7 ticks across the range, snapped to 1/2/5 x 10^n. */
function ticks(min: number, max: number): number[] {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) return [];
  const rough = span / 7;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  const step = (normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1) * magnitude;

  const out: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let t = start; t <= max + step * 1e-6 && out.length < 40; t += step) {
    out.push(Math.abs(t) < step * 1e-6 ? 0 : t);
  }
  return out;
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
