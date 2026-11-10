"use client";

import { useEffect, useRef, useState } from "react";
import type { Attachment } from "@/lib/types";
import { AudioIcon, DocumentIcon, ImageIcon, PlotIcon, SendIcon, StopIcon, XIcon } from "./icons";
import {
  AttachmentRejected,
  MAX_ATTACHMENTS,
  clipboardHasFiles,
  filesFromClipboard,
  formatBytes,
  readAttachments,
} from "@/lib/attachment";

const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif," +
  "application/pdf,audio/*";

export function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
  onOpenPlotter,
}: {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
  onOpenPlotter: () => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  async function addFiles(files: File[]) {
    if (!files.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setNotice(`At most ${MAX_ATTACHMENTS} attachments per message.`);
      return;
    }
    setBusy(true);
    try {
      const added = await readAttachments(files.slice(0, room));
      setAttachments((prev) => [...prev, ...added].slice(0, MAX_ATTACHMENTS));
      if (files.length > room) setNotice(`Only the first ${MAX_ATTACHMENTS} attachments were added.`);
    } catch (err) {
      setNotice(err instanceof AttachmentRejected ? err.message : "That file could not be read.");
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || disabled) return;
    onSend(trimmed, attachments);
    setText("");
    setAttachments([]);
  }

  const canSend = !disabled && (text.trim().length > 0 || attachments.length > 0);

  return (
    <div className="px-3 pt-1 pb-4 sm:px-6">
      <div className="mx-auto max-w-3xl">
        {notice && (
          <p className="rise mb-2 flex items-center gap-1.5 text-[0.75rem] text-danger">{notice}</p>
        )}

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <AttachmentChip
                key={`${a.name}-${i}`}
                attachment={a}
                onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void addFiles(Array.from(e.dataTransfer.files));
          }}
          className={`composer relative flex items-end gap-0.5 rounded-[1.75rem] border p-1.5 transition-[border-color,box-shadow,background-color] duration-200 ${
            dragging
              ? "border-accent bg-accent/[0.06]"
              : focused
                ? "border-ink-400 bg-ink-150"
                : "border-stroke bg-ink-150"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || busy}
            aria-label="Attach a file"
            title="Attach an image, PDF or audio clip"
            className="composer-icon"
          >
            {busy ? <SpinnerDot /> : <PlusIcon className="h-[1.15rem] w-[1.15rem]" />}
          </button>

          <button
            type="button"
            onClick={onOpenPlotter}
            aria-label="Open the plotter"
            title="Plot a graph"
            className="composer-icon"
          >
            <PlotIcon className="h-[1.15rem] w-[1.15rem]" />
          </button>

          <textarea
            ref={areaRef}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onPaste={(e) => {
              // A pasted file takes priority; text paste falls through untouched.
              if (!clipboardHasFiles(e.clipboardData)) return;
              const files = filesFromClipboard(e.clipboardData);
              if (!files.length) return;
              e.preventDefault();
              void addFiles(files);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about any homework, or paste a file…"
            className="max-h-[15rem] flex-1 resize-none bg-transparent px-1.5 py-2.5 text-[0.9375rem] leading-relaxed text-ink-900 outline-none placeholder:text-ink-500"
          />

          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              title="Stop"
              className="composer-send border border-stroke bg-ink-100 text-ink-800 hover:bg-ink-200"
            >
              <StopIcon className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send"
              title="Send"
              className={`composer-send ${
                canSend
                  ? "bg-solid text-solid-fg hover:opacity-90 active:scale-95"
                  : "bg-ink-300 text-ink-500"
              }`}
            >
              <SendIcon className="h-[1.15rem] w-[1.15rem]" />
            </button>
          )}
        </div>

        <p className="mt-2 text-center text-[0.6875rem] text-ink-500">
          Paste or drop images, PDFs and audio. Everything stays on this device.
        </p>
      </div>
    </div>
  );
}

/** One attached file. Images preview; documents and audio get a labelled chip. */
function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const showPreview = attachment.kind === "image" && !broken;

  return (
    <div className="rise group relative flex items-center gap-2.5 overflow-hidden rounded-xl border border-stroke bg-ink-150 py-1.5 pr-8 pl-1.5">
      {showPreview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          onError={() => setBroken(true)}
          className="h-10 w-10 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink-250 text-ink-700">
          {attachment.kind === "audio" ? (
            <AudioIcon className="h-4 w-4" />
          ) : attachment.kind === "document" ? (
            <DocumentIcon className="h-4 w-4" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
        </span>
      )}

      <span className="min-w-0">
        <span className="block max-w-[11rem] truncate text-[0.75rem] font-medium text-ink-800">
          {attachment.name}
        </span>
        <span className="block text-[0.6875rem] text-ink-500">
          {attachment.kind === "document" && attachment.pages
            ? `${attachment.pages} page${attachment.pages > 1 ? "s" : ""} · `
            : ""}
          {formatBytes(attachment.bytes)}
        </span>
      </span>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.name}`}
        className="absolute top-1/2 right-1.5 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink-250 hover:text-ink-900"
      >
        <XIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      aria-hidden
      className={className}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Small rotating ring shown on the attach button while a file is being read. */
function SpinnerDot() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden
      className="spin h-[1.05rem] w-[1.05rem]"
    >
      <circle cx="12" cy="12" r="8.5" opacity="0.25" />
      <path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5" />
    </svg>
  );
}
