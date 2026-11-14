"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Attachment, ChatMessage } from "@/lib/types";
import { ChatError, streamChat } from "@/lib/api";
import { routeModel } from "@/lib/models";
import {
  CaptureError,
  canCaptureScreen,
  grabFrame,
  pipApi,
  primeVideo,
  startScreenShare,
} from "@/lib/capture";
import { Markdown } from "./Markdown";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CollapseIcon,
  ExpandIcon,
  PopOutIcon,
  ScreenIcon,
  XIcon,
} from "./icons";

/** Characters of an answer revealed per second, so it plays like a video. */
const REVEAL_CPS = 44;
/** How often the reveal advances, in ms. */
const REVEAL_TICK_MS = 90;
/** The question the reader asks when the user has not typed one. */
const DEFAULT_QUESTION = "Read this and solve the question on screen.";
/** Most turns kept. Only the newest is shown; the rest are history. */
const MAX_TURNS = 12;

interface Turn {
  id: string;
  question: string;
  answer: string;
  error?: string;
}

function clock(total: number): string {
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(total % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * Study mode, built as a media player. Sharing a screen puts the live screen on
 * the stage as the video, and the answer plays out beneath it, revealed a
 * character at a time like playback. The Answer button reads whatever is on
 * screen now, so the user controls when a page is read.
 *
 * The stage shows the same frame the model is given, so what is on screen is
 * exactly what is read. Nothing here is persisted: turns live in this
 * component's memory and are dropped when the panel closes, so an extension
 * reading the page or the site's storage sees an empty chat.
 */
export function StudyMode({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [revealed, setRevealed] = useState<Record<string, number>>({});
  const [elapsed, setElapsed] = useState(0);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [isFull, setIsFull] = useState(false);
  /** Collapsed to a small pill, so the player covers as little as possible. */
  const [minimized, setMinimized] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const captionRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  /** Signature of the page we last read, and the candidate next one. */
  const readSignature = useRef<string | null>(null);
  const inFlight = useRef<Set<AbortController>>(new Set());
  const idRef = useRef(0);
  const turnsRef = useRef<Turn[]>([]);
  /** Whether the caption is pinned to the bottom, like a live transcript. */
  const stick = useRef(true);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  /** Runs one question against a captured frame, streaming into the turn. */
  const ask = useCallback(async (attachment: Attachment, question: string, id: string) => {
    const controller = new AbortController();
    inFlight.current.add(controller);
    setBusy(true);
    try {
      const model = routeModel({ hasImages: true, hasAudio: false, prompt: question });
      const history: ChatMessage[] = [
        { id, role: "user", content: question, attachments: [attachment], createdAt: Date.now() },
      ];
      await streamChat(model, history, question, controller.signal, {
        onReasoning: () => {},
        onContent: (delta) => {
          setTurns((prev) =>
            prev.map((t) => (t.id === id ? { ...t, answer: t.answer + delta } : t)),
          );
        },
        onSources: () => {},
        onDone: () => {},
      });
    } catch (err) {
      const message = controller.signal.aborted
        ? undefined
        : err instanceof ChatError
          ? err.message
          : "Could not read the screen.";
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, error: message } : t)));
    } finally {
      inFlight.current.delete(controller);
      // Only clear the busy flag once every request has finished, so a typed
      // question that overlaps an auto answer does not read as "idle" early.
      if (inFlight.current.size === 0) setBusy(false);
    }
  }, []);

  /**
   * Grabs a frame and asks about it. `explicit` marks a deliberate read: it runs
   * even while another answer streams, so a typed question is never dropped.
   */
  const scan = useCallback(
    (question?: string, explicit = false) => {
      const video = videoRef.current;
      if (!video || !streamRef.current) return;
      const asked = question?.trim() ?? "";
      if (busyRef.current && !explicit) return;

      const attachment = grabFrame(video, "Screen");
      if (!attachment) return;

      const id = `t${idRef.current++}`;
      const text = asked || DEFAULT_QUESTION;
      setTurns((prev) => [...prev, { id, question: text, answer: "" }].slice(-MAX_TURNS));
      setRevealed((prev) => ({ ...prev, [id]: 0 }));
      stick.current = true;
      void ask(attachment, text, id);
    },
    [ask],
  );

  const stopShare = useCallback(() => {
    for (const controller of inFlight.current) controller.abort();
    inFlight.current.clear();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    readSignature.current = null;
    setSharing(false);
    setBusy(false);
  }, []);

  const beginShare = useCallback(async () => {
    setError(null);
    try {
      const stream = await startScreenShare();
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      await primeVideo(stream, video);
      stream.getVideoTracks()[0]?.addEventListener("ended", stopShare);
      readSignature.current = null;
      setElapsed(0);
      setSharing(true);
    } catch (err) {
      setError(err instanceof CaptureError ? err.message : "Screen sharing could not start.");
    }
  }, [stopShare]);

  // The reveal. Buffered text plays out at a readable speed, so the answer
  // arrives like a video rather than snapping into place.
  useEffect(() => {
    if (!open) return;
    const perTick = Math.max(1, Math.round((REVEAL_CPS * REVEAL_TICK_MS) / 1000));
    const timer = window.setInterval(() => {
      setRevealed((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const t of turnsRef.current) {
          if (t.error) continue;
          const cur = next[t.id] ?? 0;
          if (cur < t.answer.length) {
            next[t.id] = Math.min(t.answer.length, cur + perTick);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, REVEAL_TICK_MS);
    return () => window.clearInterval(timer);
  }, [open]);

  // Elapsed time, counting up while a screen is shared.
  useEffect(() => {
    if (!open || !sharing) return;
    const timer = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(timer);
  }, [open, sharing]);

  // Follow the reveal, unless the user has scrolled up to read something.
  useEffect(() => {
    const el = captionRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [revealed, turns]);

  useEffect(() => {
    const onFs = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Releasing the stream on unmount stops the browser's sharing indicator.
  useEffect(() => stopShare, [stopShare]);

  const popOut = useCallback(async () => {
    const pip = pipApi();
    if (!pip) return;
    try {
      const win = await pip.requestWindow({ width: 460, height: 640 });
      copyStyles(document, win.document);
      const observer = new MutationObserver(() => {
        win.document.documentElement.className = document.documentElement.className;
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      win.addEventListener("pagehide", () => observer.disconnect());
      setPipWindow(win);
    } catch {
      setError("The floating window could not open.");
    }
  }, []);

  const close = useCallback(() => {
    pipWindow?.close();
    setPipWindow(null);
    stopShare();
    setTurns([]);
    setRevealed({});
    setElapsed(0);
    onClose();
  }, [pipWindow, stopShare, onClose]);

  const toggleFull = useCallback(() => {
    const el = panelRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, []);

  const onCaptionScroll = useCallback(() => {
    const el = captionRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
  }, []);

  if (!open) return null;

  const collapsed = minimized && !pipWindow;
  const current = turns.length ? turns[turns.length - 1] : null;
  const shownCount = current ? (revealed[current.id] ?? 0) : 0;
  const shown = current ? current.answer.slice(0, shownCount) : "";
  const playing = Boolean(current && shownCount < current.answer.length);

  const panel = (
    <div
      ref={panelRef}
      className={`study-panel study-player ${pipWindow ? "study-floating" : ""} ${
        collapsed ? "study-mini" : ""
      }`}
      aria-label="Study mode"
    >
      <div className="study-head">
        <ScreenIcon className="h-4 w-4 text-ink-700" />
        <span className="text-[0.875rem] font-medium text-ink-900">Study</span>
        {sharing && <span className="study-status">Live</span>}
        <div className="ml-auto flex items-center gap-1">
          {!pipWindow && (
            <button
              type="button"
              onClick={() => setMinimized((m) => !m)}
              aria-label={minimized ? "Expand" : "Minimize"}
              title={minimized ? "Expand" : "Minimize"}
              className="icon-button h-7 w-7"
            >
              {minimized ? (
                <ChevronUpIcon className="h-4 w-4" />
              ) : (
                <ChevronDownIcon className="h-4 w-4" />
              )}
            </button>
          )}
          {!pipWindow && pipApi() && (
            <button
              type="button"
              onClick={() => void popOut()}
              aria-label="Float on top"
              title="Float on top of other windows"
              className="icon-button h-7 w-7"
            >
              <PopOutIcon className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={close}
            aria-label="Close study mode"
            title="Close"
            className="icon-button h-7 w-7"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="study-stage">
            <video ref={videoRef} playsInline muted aria-hidden />
            {!sharing && (
              <div className="study-stage-idle">
                <ScreenIcon className="h-5 w-5" />
                <p>
                  {canCaptureScreen()
                    ? "Share your screen to begin. Answers play here."
                    : "Screen sharing is not available in this browser."}
                </p>
                <button
                  type="button"
                  onClick={() => void beginShare()}
                  disabled={!canCaptureScreen()}
                  className="study-btn study-btn-primary"
                >
                  <ScreenIcon className="h-4 w-4" />
                  Share screen
                </button>
              </div>
            )}
            {sharing && (
              <span className="study-veil">
                <span className="study-veil-dot" />
                {busy ? "Reading" : playing ? "Answering" : "Watching"}
              </span>
            )}
            {sharing && error && (
              <span className="study-veil study-veil-error">
                <span className="study-veil-dot" />
                {error}
              </span>
            )}
          </div>

          {sharing && (
            <>
              <div className="study-transport">
                <button
                  type="button"
                  onClick={() => scan(undefined, true)}
                  disabled={busy}
                  className="study-answer-btn"
                  title="Answer the page on screen"
                >
                  {busy ? "Reading\u2026" : "Answer"}
                </button>
                <span className="study-time">{clock(elapsed)}</span>
                <span className="study-spacer" />
                {!pipWindow && (
                  <button
                    type="button"
                    onClick={toggleFull}
                    aria-label={isFull ? "Exit full screen" : "Full screen"}
                    title={isFull ? "Exit full screen" : "Full screen"}
                    className="icon-button h-7 w-7"
                  >
                    {isFull ? (
                      <CollapseIcon className="h-4 w-4" />
                    ) : (
                      <ExpandIcon className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
              <div className="study-progress">
                <div className="study-progress-fill" />
              </div>
            </>
          )}

          <div className="study-caption" ref={captionRef} onScroll={onCaptionScroll}>
            {!current ? (
              <p className="study-caption-empty">
                {sharing
                  ? "Watching your screen. The answer plays here on its own."
                  : "Nothing yet. Share a screen and open the assignment."}
              </p>
            ) : (
              <>
                <p className="study-now">
                  Now: <strong>{current.question}</strong>
                </p>
                {current.error ? (
                  <p className="study-error">{current.error}</p>
                ) : shown ? (
                  <div className="study-answer study-block">
                    <Markdown>{shown}</Markdown>
                    {playing && <span className="study-caret" />}
                  </div>
                ) : (
                  <p className="study-thinking">
                    <span className="study-dot" />
                    Reading…
                  </p>
                )}
              </>
            )}
          </div>

          {sharing && (
            <div className="study-foot">
              {askOpen ? (
                <div className="study-ask">
                  <input
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        const q = draft;
                        setDraft("");
                        setAskOpen(false);
                        scan(q, true);
                      }
                      if (e.key === "Escape") setAskOpen(false);
                    }}
                    placeholder="Ask about the screen…"
                    aria-label="Ask about the screen"
                    className="study-input"
                  />
                </div>
              ) : (
                <button type="button" onClick={() => setAskOpen(true)} className="study-ask-toggle">
                  Ask about the screen
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  return pipWindow ? createPortal(panel, pipWindow.document.body) : panel;
}

/** Copies every stylesheet and font rule into the floating window's head. */
function copyStyles(from: Document, to: Document) {
  const head = to.head;
  head.querySelectorAll("[data-folio-style]").forEach((n) => n.remove());
  from.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    const clone = node.cloneNode(true) as HTMLElement;
    clone.setAttribute("data-folio-style", "");
    head.appendChild(clone);
  });
  to.documentElement.className = from.documentElement.className;
  to.documentElement.style.cssText = from.documentElement.style.cssText;
}
