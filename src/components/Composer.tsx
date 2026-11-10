"use client";

import { useEffect, useRef, useState } from "react";
import type { Attachment } from "@/lib/types";
import { ImageIcon, PlotIcon, SendIcon, StopIcon, XIcon } from "./icons";
import { ImageRejected, MAX_IMAGES_PER_MESSAGE, formatBytes, scrubImages } from "@/lib/image";

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
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    try {
      const room = MAX_IMAGES_PER_MESSAGE - attachments.length;
      if (room <= 0) {
        setNotice(`At most ${MAX_IMAGES_PER_MESSAGE} images per message.`);
        return;
      }
      const scrubbed = await scrubImages(files.slice(0, room));
      setAttachments((prev) => [...prev, ...scrubbed]);
    } catch (err) {
      setNotice(err instanceof ImageRejected ? err.message : "That image could not be processed.");
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

  return (
    <div className="bg-ink-100 px-3 pt-2 pb-4 sm:px-6">
      <div className="mx-auto max-w-3xl">
        {notice && <p className="rise mb-2 text-[0.75rem] text-danger">{notice}</p>}

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <div
                key={`${a.label}-${i}`}
                className="rise group relative overflow-hidden rounded-xl border border-stroke"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.dataUrl} alt={a.label} className="h-16 w-16 object-cover" />
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Remove ${a.label}`}
                  className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <XIcon className="h-3 w-3" />
                </button>
                <span className="absolute right-0 bottom-0 left-0 bg-black/60 px-1 py-0.5 text-center text-[0.5625rem] text-white/80">
                  {formatBytes(a.bytes)}
                </span>
              </div>
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
          className={`flex items-end gap-1.5 rounded-[26px] border bg-ink-150 p-2 shadow-sm transition-colors ${
            dragging ? "border-accent bg-accent/5" : "border-stroke focus-within:border-ink-400"
          }`}
        >
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || busy}
            aria-label="Attach an image"
            title="Attach an image"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-600 transition-colors hover:bg-ink-250 hover:text-ink-900 disabled:opacity-40"
          >
            <ImageIcon className="h-[1.15rem] w-[1.15rem]" />
          </button>
          <button
            type="button"
            onClick={onOpenPlotter}
            aria-label="Open the plotter"
            title="Plot a graph"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-600 transition-colors hover:bg-ink-250 hover:text-ink-900"
          >
            <PlotIcon className="h-[1.15rem] w-[1.15rem]" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          <textarea
            ref={areaRef}
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about any homework…"
            className="max-h-[12.5rem] flex-1 resize-none bg-transparent py-2 text-[0.9375rem] leading-relaxed text-ink-900 outline-none placeholder:text-ink-500"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stroke bg-ink-100 text-ink-800 transition-colors hover:bg-ink-200"
            >
              <StopIcon className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={disabled || (!text.trim() && attachments.length === 0)}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-solid text-solid-fg transition-opacity hover:opacity-85 disabled:bg-ink-300 disabled:text-ink-500"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        <p className="mt-2 text-center text-[0.6875rem] text-ink-500">
          Folio can make mistakes. Check important answers.
        </p>
      </div>
    </div>
  );
}
