"use client";

import type { Source } from "@/lib/types";
import { monogram, registrableDomain } from "@/lib/domain";

/**
 * The inline citation that replaces a `[n]` marker in an answer. Small enough
 * to sit in a sentence, and it names the site on hover so a reader can judge the
 * source without leaving the answer.
 *
 * Clicking scrolls to the matching row in the {@link Sources} panel instead of
 * opening the site, so the row's title and snippet are read first. That keeps a
 * click from being a surprise navigation.
 */
export function CiteChip({ n, source }: { n: number; source?: Source }) {
  const host = source?.host ?? "";
  const domain = registrableDomain(host);
  const label = source ? `${source.site || domain} — ${source.title || host}` : `Source ${n}`;

  return (
    <button
      type="button"
      onClick={() => revealSource(n)}
      title={label}
      aria-label={`Source ${n}: ${label}`}
      className="cite-chip"
    >
      {source && (
        <span className="cite-chip-badge" aria-hidden="true">
          {monogram(domain)}
        </span>
      )}
      <span className="cite-chip-n">{n}</span>
    </button>
  );
}

/** Opens the sources panel if it is shut, then scrolls the row into view. */
export function revealSource(n: number) {
  const row = document.getElementById(`folio-source-${n}`);
  if (!row) return;
  // The panel starts collapsed. Its header is the only control that opens it,
  // and it is a plain button, so a synthetic click is enough.
  const header = row.closest("[data-sources-panel]")?.querySelector("button[aria-expanded]");
  if (header instanceof HTMLButtonElement && header.getAttribute("aria-expanded") === "false") {
    header.click();
  }
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("source-row-flash");
  window.setTimeout(() => row.classList.remove("source-row-flash"), 1200);
}
