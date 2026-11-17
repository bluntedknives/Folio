"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { Markdown } from "./Markdown";
import { Thinking } from "./Thinking";
import { Working } from "./Working";
import { Sources } from "./Sources";
import { VideoCard } from "./VideoCard";
import { PageCard } from "./PageCard";
import { copyFormatted } from "@/lib/export";
import { findVideoUrl } from "@/lib/youtube";
import { findWebLinks } from "@/lib/urls";
import { AudioIcon, CheckIcon, CopyIcon, FolioMark, RefreshIcon } from "./icons";

/**
 * An attached video, drawn from its local data URL so nothing is re-fetched.
 * The player is muted and paused: it is there so the student can confirm they
 * attached the right clip, not to play it back at them.
 */
function VideoAttachment({
  src,
  poster,
  name,
}: {
  src: string;
  poster?: string;
  name: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-stroke bg-ink-150">
      <video
        src={src}
        poster={poster || undefined}
        controls
        muted
        playsInline
        preload="metadata"
        title={name}
        className="max-h-56 w-full max-w-[22rem] bg-black object-contain"
      />
    </div>
  );
}

export function MessageBubble({
  message,
  streaming,
  workingLabel,
  onRegenerate,
}: {
  message: ChatMessage;
  streaming: boolean;
  workingLabel?: string;
  onRegenerate?: () => void;
}) {
  if (message.role === "user") return <UserBubble message={message} />;
  return (
    <AssistantBubble
      message={message}
      streaming={streaming}
      workingLabel={workingLabel}
      onRegenerate={onRegenerate}
    />
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  // A link is pulled out of the text and shown as a card instead, so a long
  // URL does not sit in the middle of the sentence. YouTube gets the video
  // card, every other address gets the page card.
  const video = findVideoUrl(message.content);
  const pages = video ? [] : findWebLinks(message.content);
  const body = stripLinks(message.content, [
    ...(video ? [video.url] : []),
    ...pages.map((p) => p.url),
  ]);

  return (
    <div className="rise flex justify-end px-4 py-3 sm:px-6">
      <div className="flex max-w-[min(42rem,85%)] flex-col items-end gap-2">
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {message.attachments.map((a, i) =>
              a.kind === "video" ? (
                <VideoAttachment
                  key={`${a.name}-${i}`}
                  src={a.dataUrl}
                  poster={a.poster}
                  name={a.name}
                />
              ) : a.kind === "image" || a.kind === "document" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${a.name}-${i}`}
                  src={a.dataUrl}
                  alt={a.name}
                  title={a.name}
                  className="h-24 w-24 rounded-xl border border-stroke object-cover"
                />
              ) : (
                <span
                  key={`${a.name}-${i}`}
                  className="flex h-24 w-24 flex-col items-center justify-center gap-1.5 rounded-xl border border-stroke bg-ink-150 text-ink-600"
                >
                  <AudioIcon className="h-5 w-5" />
                  <span className="max-w-[5rem] truncate px-1 text-[0.625rem]">{a.name}</span>
                </span>
              ),
            )}
          </div>
        )}
        {video && <VideoCard url={video.url} />}
        {pages.map((page) => (
          <PageCard key={page.url} url={page.url} />
        ))}
        {body.trim() && (
          <div className="rounded-3xl rounded-br-lg bg-ink-150 px-4 py-2.5 text-[0.9375rem] leading-relaxed whitespace-pre-wrap text-ink-900">
            {body.trim()}
          </div>
        )}
      </div>
    </div>
  );
}

/** Removes the link URLs from the text, leaving the words around them. */
function stripLinks(text: string, urls: string[]): string {
  let out = text;
  for (const url of urls) out = out.replace(url, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function AssistantBubble({
  message,
  streaming,
  workingLabel,
  onRegenerate,
}: {
  message: ChatMessage;
  streaming: boolean;
  workingLabel?: string;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const empty = !message.content.trim();

  async function copy() {
    try {
      await copyFormatted(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="rise group flex gap-3 px-4 py-4 sm:px-6">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
        <FolioMark
          className={`h-[1.35rem] w-[1.35rem] ${
            streaming ? "text-accent pulse-soft" : "text-ink-800"
          }`}
        />
      </div>

      <div className="min-w-0 flex-1 pt-0.5">
        {message.reasoning && (
          <Thinking text={message.reasoning} streaming={streaming && empty} answerStarted={!empty} />
        )}

        {message.error ? (
          <div className="rounded-xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-[0.875rem] text-danger">
            {message.error}
          </div>
        ) : empty && streaming ? (
          <Working label={workingLabel ?? "Thinking"} />
        ) : (
          <Markdown>{message.content}</Markdown>
        )}

        {!streaming && message.sources && message.sources.length > 0 && (
          <Sources sources={message.sources} />
        )}
      </div>

      {!streaming && !message.error && !empty && (
        <div className="mt-0.5 flex shrink-0 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy answer"}
            title={copied ? "Copied" : "Copy answer"}
            className="icon-button h-6 w-6"
          >
            {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
          </button>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              aria-label="Regenerate answer"
              title="Regenerate answer"
              className="icon-button h-6 w-6"
            >
              <RefreshIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
