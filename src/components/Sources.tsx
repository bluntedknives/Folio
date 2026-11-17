"use client";

import { useState } from "react";
import type { Source } from "@/lib/types";
import { ChevronIcon, GlobeIcon } from "./icons";
import { monogram, pathOf, registrableDomain } from "@/lib/domain";

/**
 * The web results an answer was grounded in, shown under it. Collapsed by
 * default so it never competes with the answer, and only rendered when search
 * actually ran and returned something.
 *
 * Each row leads with the site's domain, because that is what tells a student
 * whether a source is worth trusting. The domain is resolved on the server from
 * the result URL, so the label and the link can never disagree. The badge is a
 * monogram rather than the site's favicon: fetching one would tell the site's
 * server that this chat happened, which is exactly what this app promises not
 * to do.
 */
export function Sources({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);

  if (sources.length === 0) return null;

  return (
    <div data-sources-panel className="mt-3 overflow-hidden rounded-lg border border-stroke bg-ink-100/60">
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
          <ul className="border-t border-stroke p-1.5">
            {sources.map((source, i) => (
              <SourceRow key={`${source.url}-${i}`} source={source} index={i + 1} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** One result: the whole row is the link, and the domain leads. */
function SourceRow({ source, index }: { source: Source; index: number }) {
  const host = source.host ?? hostOf(source.url);
  const domain = registrableDomain(host);
  const path = pathOf(source.url);

  return (
    <li id={`folio-source-${index}`} className="scroll-mt-24">
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        title={source.site ? `${source.site} — ${host}` : host}
        className="source-row group flex items-start gap-2.5 rounded-md px-2 py-2"
      >
        <span className="source-badge" aria-hidden="true">
          {monogram(domain)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="source-title">{source.title || host}</span>
          {/* The domain is shown exactly as the URL carries it, so the label
              and the link can never disagree. */}
          <span className="source-host">
            <span className="source-site">{host}</span>
            {path && <span className="source-path">/{truncatePath(path)}</span>}
          </span>
        </span>
        <span className="source-index">{index}</span>
      </a>
    </li>
  );
}

/** Keeps the breadcrumb to a readable tail without cutting a segment in half. */
function truncatePath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 2) return segments.join("/");
  return segments.slice(-2).join("/");
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url;
  }
}
