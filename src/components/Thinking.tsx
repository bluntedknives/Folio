"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronIcon, ThoughtIcon } from "./icons";
import { Markdown } from "./Markdown";

/**
 * Chain-of-thought panel. Reasoning models emit `reasoning_content` before
 * the answer, so this collapses automatically once real content starts and
 * shows a live token count while it streams.
 */
export function Thinking({
  text,
  streaming,
  answerStarted,
}: {
  text: string;
  streaming: boolean;
  answerStarted: boolean;
}) {
  // Open while the model is still thinking, then collapse the moment the
  // answer starts so the reasoning never buries it. A manual toggle wins.
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const open = manualOpen ?? !answerStarted;

  useEffect(() => {
    if (open && streaming && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [text, open, streaming]);

  if (!text.trim()) return null;

  return (
    <div className="rise mb-3 overflow-hidden rounded-lg border border-stroke bg-ink-100/60">
      <button
        type="button"
        onClick={() => setManualOpen((v) => !(v ?? !answerStarted))}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ThoughtIcon className={`h-3.5 w-3.5 ${streaming ? "text-accent" : "text-ink-600"}`} />
        <span
          className={`text-[11px] font-medium tracking-wide ${
            streaming ? "shimmer" : "text-ink-600"
          }`}
        >
          {streaming ? "Thinking" : `Thought for ${estimateSeconds(text)}s`}
        </span>
        <ChevronIcon
          className={`ml-auto h-3.5 w-3.5 text-ink-600 transition-transform duration-300 ${
            open ? "rotate-90" : ""
          }`}
        />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div
            ref={bodyRef}
            className="max-h-64 overflow-y-auto border-t border-stroke px-3 py-2.5"
          >
            <Markdown variant="think">{text}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Rough read-time estimate, capped so it never looks absurd. */
function estimateSeconds(text: string): number {
  return Math.min(99, Math.max(1, Math.round(text.length / 220)));
}
