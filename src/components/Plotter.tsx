"use client";

import { useMemo, useState } from "react";
import { GraphCanvas } from "./graph/Graph";
import { buildGraphSpec, toGraphFence, type PlotInput } from "@/lib/graph/build";
import { PALETTE } from "@/lib/graph/spec";
import { evalConstant } from "@/lib/math/expression";
import { PlusIcon, PlotIcon, SendIcon, XIcon } from "./icons";

interface Row extends PlotInput {
  key: number;
}

const DEFAULT_X: [number, number] = [-6, 6];

/**
 * A graphing calculator that shares the renderer used for the model's
 * ```graph blocks. Type curves, watch them draw, then send the plot into the
 * chat as a question or keep it to check an answer by eye.
 */
export function Plotter({
  open,
  onClose,
  onAsk,
}: {
  open: boolean;
  onClose: () => void;
  onAsk: (text: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([{ key: 0, expr: "x^2 - 2x - 3" }]);
  const [nextKey, setNextKey] = useState(1);
  const [title, setTitle] = useState("");
  const [xMin, setXMin] = useState(String(DEFAULT_X[0]));
  const [xMax, setXMax] = useState(String(DEFAULT_X[1]));
  const [yMin, setYMin] = useState("");
  const [yMax, setYMax] = useState("");

  const built = useMemo(
    () =>
      buildGraphSpec({
        title,
        xMin: evalConstant(xMin) ?? DEFAULT_X[0],
        xMax: evalConstant(xMax) ?? DEFAULT_X[1],
        yMin: yMin.trim() ? (evalConstant(yMin) ?? undefined) : undefined,
        yMax: yMax.trim() ? (evalConstant(yMax) ?? undefined) : undefined,
        plots: rows,
      }),
    [rows, title, xMin, xMax, yMin, yMax],
  );

  function updateRow(key: number, expr: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, expr } : r)));
  }

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: nextKey, expr: "", color: PALETTE[prev.length % PALETTE.length] },
    ]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: number) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((r) => r.key !== key)));
  }

  function ask() {
    if (!built.ok) return;
    onAsk(
      `Explain this graph and what it shows:\n\n${toGraphFence(built.spec)}\n\n` +
        "Walk through the shape, the key points and anything notable.",
    );
    onClose();
  }

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={`fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-label="Graph plotter"
        aria-hidden={!open}
        inert={!open}
        className={`fixed inset-y-0 right-0 z-40 flex w-full max-w-[26rem] flex-col bg-ink-100 transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 px-4">
          <PlotIcon className="h-4 w-4 text-ink-700" />
          <h2 className="text-[0.9375rem] font-medium text-ink-900">Plotter</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close plotter"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-ink-600 hover:bg-ink-200 hover:text-ink-900"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-stroke p-4">
            <label className="plotter-label" htmlFor="plot-title">
              Title
            </label>
            <input
              id="plot-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Optional"
              className="plotter-input"
            />

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="plotter-label" htmlFor="x-min">
                  x from
                </label>
                <input
                  id="x-min"
                  value={xMin}
                  onChange={(e) => setXMin(e.target.value)}
                  inputMode="text"
                  className="plotter-input font-mono"
                />
              </div>
              <div>
                <label className="plotter-label" htmlFor="x-max">
                  x to
                </label>
                <input
                  id="x-max"
                  value={xMax}
                  onChange={(e) => setXMax(e.target.value)}
                  inputMode="text"
                  className="plotter-input font-mono"
                />
              </div>
              <div>
                <label className="plotter-label" htmlFor="y-min">
                  y from
                </label>
                <input
                  id="y-min"
                  value={yMin}
                  onChange={(e) => setYMin(e.target.value)}
                  placeholder="auto"
                  className="plotter-input font-mono"
                />
              </div>
              <div>
                <label className="plotter-label" htmlFor="y-max">
                  y to
                </label>
                <input
                  id="y-max"
                  value={yMax}
                  onChange={(e) => setYMax(e.target.value)}
                  placeholder="auto"
                  className="plotter-input font-mono"
                />
              </div>
            </div>
            <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-500">
              Ranges accept expressions: <span className="font-mono">-2pi..2pi</span>,{" "}
              <span className="font-mono">0..tau</span>.
            </p>
          </div>

          <div className="border-b border-stroke p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="plotter-label mb-0">Curves</span>
              <button
                type="button"
                onClick={addRow}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[0.6875rem] text-ink-600 transition-colors hover:bg-ink-200 hover:text-ink-900"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                Add
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {rows.map((row, i) => (
                <div key={row.key} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: row.color ?? PALETTE[i % PALETTE.length] }}
                  />
                  <span className="shrink-0 font-mono text-[0.8125rem] text-ink-600">y =</span>
                  <input
                    value={row.expr}
                    onChange={(e) => updateRow(row.key, e.target.value)}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    placeholder="sin(x)"
                    aria-label={`Curve ${i + 1}`}
                    className="plotter-input flex-1 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    disabled={rows.length === 1}
                    aria-label={`Remove curve ${i + 1}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-ink-200 hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4">
            {/* Only render the preview while the panel is visible: a hidden
                SVG would keep sampling curves nobody can see. */}
            {!built.ok ? (
              <div className="plotter-empty">
                <p>{built.error}</p>
              </div>
            ) : open ? (
              <GraphCanvas spec={built.spec} />
            ) : (
              <div className="plotter-empty" aria-hidden>
                <p>Preview</p>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-stroke p-3">
          <button
            type="button"
            onClick={ask}
            disabled={!built.ok}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-solid px-3 py-2.5 text-[0.8125rem] font-medium text-solid-fg transition-opacity hover:opacity-85 disabled:bg-ink-300 disabled:text-ink-500"
          >
            <SendIcon className="h-3.5 w-3.5" />
            Ask about this graph
          </button>
        </div>
      </aside>
    </>
  );
}
