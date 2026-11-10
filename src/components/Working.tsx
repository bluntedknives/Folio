"use client";

import { SpinnerIcon } from "./icons";

/**
 * Shown in an assistant turn while the model is still working and has not
 * written any answer text yet. The label says what it is doing, not which
 * model was picked, since the model is chosen automatically.
 */
export function Working({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5" role="status" aria-live="polite">
      <SpinnerIcon className="spin h-3.5 w-3.5 text-accent" />
      <span className="working-label text-[0.8125rem] text-ink-600">{label}</span>
      <span aria-hidden className="flex items-center gap-[3px]">
        <span className="working-dot" />
        <span className="working-dot" />
        <span className="working-dot" />
      </span>
    </div>
  );
}
