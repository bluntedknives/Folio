"use client";

import { findVideoUrl } from "@/lib/youtube";

/**
 * A linked video shown under the user's message. Only the link is known on the
 * client: the title, channel and stills live on the server, which reads them
 * per turn. So this renders what it can from the URL itself and nothing more,
 * rather than storing metadata that could go stale.
 */
export function VideoCard({ url }: { url: string }) {
  const found = findVideoUrl(url);
  if (!found) return null;

  const thumbnail = `https://i.ytimg.com/vi/${found.id}/hqdefault.jpg`;

  return (
    <a
      href={found.url}
      target="_blank"
      rel="noopener noreferrer"
      className="video-card group flex w-full max-w-md items-center gap-3 overflow-hidden rounded-xl border border-stroke bg-ink-150 p-2 pr-3.5 transition-colors hover:border-stroke-strong hover:bg-ink-200"
    >
      <span className="relative block h-14 w-24 shrink-0 overflow-hidden rounded-lg bg-ink-250">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbnail}
          alt=""
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        />
        <span className="video-card-play" aria-hidden>
          <PlayGlyph />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[0.625rem] font-medium tracking-wide text-ink-500 uppercase">
          <YouTubeGlyph className="h-3 w-3 text-ink-600" />
          YouTube
        </span>
        <span className="mt-0.5 block text-[0.8125rem] leading-snug text-ink-800">
          Video linked
        </span>
      </span>
    </a>
  );
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-3.5 w-3.5">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

function YouTubeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8A26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8ZM10 15V9l5.2 3Z" />
    </svg>
  );
}
