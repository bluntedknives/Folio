"use client";

import { findWebLinks } from "@/lib/urls";

/**
 * A linked web page shown under the user's message. Only the address is known
 * on the client: the server fetches the page per turn, so nothing about its
 * contents is stored with the chat and nothing about it can go stale.
 *
 * No favicon is fetched. Asking a third-party icon service for one would tell
 * it which pages are being read, which is exactly the kind of leak the rest of
 * the app avoids.
 */
export function PageCard({ url }: { url: string }) {
  const link = findWebLinks(url, 1)[0];
  if (!link) return null;

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="page-card group flex w-full max-w-md items-center gap-3 overflow-hidden rounded-xl border border-stroke bg-ink-150 p-2 pr-3.5 transition-colors hover:border-stroke-strong hover:bg-ink-200"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-ink-250">
        <GlobeGlyph className="h-5 w-5 text-ink-600" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-[0.625rem] font-medium tracking-wide text-ink-500 uppercase">
          Web page
        </span>
        <span className="mt-0.5 block truncate text-[0.8125rem] leading-snug text-ink-800">
          {link.host}
        </span>
      </span>
    </a>
  );
}

function GlobeGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </svg>
  );
}
