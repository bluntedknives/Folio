"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/types";
import { Markdown } from "./Markdown";
import { Thinking } from "./Thinking";
import { Working } from "./Working";
import { CheckIcon, CopyIcon, FolioMark, RefreshIcon } from "./icons";

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
  return (
    <div className="rise flex justify-end px-4 py-3 sm:px-6">
      <div className="flex max-w-[min(42rem,85%)] flex-col items-end gap-2">
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-2">
            {message.attachments.map((a) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={a.label}
                src={a.dataUrl}
                alt={a.label}
                className="h-24 w-24 rounded-xl border border-stroke object-cover"
              />
            ))}
          </div>
        )}
        {message.content.trim() && (
          <div className="rounded-3xl rounded-br-lg bg-ink-150 px-4 py-2.5 text-[0.9375rem] leading-relaxed whitespace-pre-wrap text-ink-900">
            {message.content}
          </div>
        )}
      </div>
    </div>
  );
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
      await navigator.clipboard.writeText(message.content);
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
