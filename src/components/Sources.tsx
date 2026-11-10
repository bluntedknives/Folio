"use client";

import { useState } from "react";
import type { Source } from "@/lib/types";
import { ChevronIcon, GlobeIcon } from "./icons";

/**
 * The web results an answer was grounded in, shown under it. Collapsed by
 * default so it never competes with the answer, and only rendered when search
 * actually ran and returned something.
 */
export function Sources({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-stroke bg-ink-100/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <GlobeIcon className="h-3.5 w-3.5 text-ink-600" />
        <span className="text-[11px] font-medium tracking-wide text-ink-600">
          {sources.length} source{sources.length > 1 ? "s" : ""}
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
          <ul className="border-t border-stroke px-3 py-2">
            {sources.map((source, i) => (
              <li key={`${source.url}-${i}`} className="py-1.5">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="source-link"
                >
                  {source.title || hostOf(source.url)}
                </a>
                <span className="mt-0.5 block truncate text-[0.6875rem] text-ink-500">
                  {hostOf(source.url)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
