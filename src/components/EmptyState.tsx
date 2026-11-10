"use client";

import { BRAND } from "@/lib/brand";
import { FolioMark, PlotIcon } from "./icons";

const STARTERS = [
  {
    title: "Solve it step by step",
    body: "Show the full working for this problem, no skipped algebra.",
  },
  {
    title: "Explain the concept",
    body: "Explain this like I have never seen it before, then give one example.",
  },
  {
    title: "Check my answer",
    body: "Here is my attempt. Find the mistake and tell me what to fix.",
  },
];

export function EmptyState({
  onPick,
  onOpenPlotter,
}: {
  onPick: (text: string) => void;
  onOpenPlotter: () => void;
}) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 py-16">
      <div className="rise flex flex-col items-center text-center">
        <FolioMark className="h-10 w-10 text-ink-900" />
        <h2 className="mt-4 text-[1.5rem] font-semibold tracking-tight text-ink-900">
          {BRAND.tagline}
        </h2>
        <p className="mt-2 max-w-sm text-[0.875rem] leading-relaxed text-ink-500">
          Paste a question, drop a photo, a PDF or a voice note. The right model is picked for you.
        </p>
      </div>

      <div className="mt-8 grid w-full gap-2 sm:grid-cols-3">
        {STARTERS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onPick(s.body)}
            style={{ animationDelay: `${80 + i * 60}ms` }}
            className="rise rounded-2xl border border-stroke bg-ink-100 px-3.5 py-3 text-left transition-colors hover:bg-ink-150"
          >
            <span className="block text-[0.8125rem] font-medium text-ink-900">{s.title}</span>
            <span className="mt-1 block text-[0.75rem] leading-relaxed text-ink-500">
              {s.body}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onOpenPlotter}
        style={{ animationDelay: "260ms" }}
        className="rise mt-2 flex w-full items-center gap-3 rounded-2xl border border-stroke bg-ink-100 p-3.5 text-left transition-colors hover:bg-ink-150"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-150 text-ink-700">
          <PlotIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-[0.8125rem] font-medium text-ink-900">Plot it yourself</span>
          <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-ink-500">
            Open the plotter and draw any curve, no question needed.
          </span>
        </span>
      </button>
    </div>
  );
}
