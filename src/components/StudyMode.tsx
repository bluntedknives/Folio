"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Attachment, ChatMessage } from "@/lib/types";
import { ChatError, streamChat } from "@/lib/api";
import { routeModel } from "@/lib/models";
import {
  CaptureError,
  canCaptureScreen,
  frameSignature,
  grabFrame,
  isBlankSignature,
  pipApi,
  primeVideo,
  signatureDistance,
  startScreenShare,
} from "@/lib/capture";
import { Markdown } from "./Markdown";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  PauseIcon,
  PopOutIcon,
  ScreenIcon,
  XIcon,
} from "./icons";

/** How often the screen is sampled for changes. */
const WATCH_INTERVAL_MS = 1500;
/** Ticks to wait after a scan, so the answer does not re-trigger on itself. */
const COOLDOWN_TICKS = 6;
/**
 * How different two frames must be to count as a new page. A still worksheet
 * sits at 0; cursor movement and video playback stay under this; a page turn or
 * a scroll clears it. Frames are compared against the last page that was read,
 * not the previous frame, so a page that is simply noisy still reads once.
 */
const CHANGE_THRESHOLD = 0.06;
/** Identical samples in a row before a new page counts as settled. */
const SETTLE_TICKS = 2;
/** Upper bound on settling, so a looping animation cannot stall the reader. */
const MAX_SETTLE_TICKS = 6;
/** Most turns kept on screen. */
const MAX_TURNS = 12;

interface Turn {
  id: string;
  question: string;
  answer: string;
  shot: string;
  error?: string;
}

/**
 * Study mode. Share a screen and the panel reads it for you: it samples the
 * screen, notices when the page changes, and asks the vision model about the
 * new page on its own. There is no play button and no transcript to manage.
 *
 * Nothing here is persisted. Turns live in this component's memory, are never
 * written to localStorage, and are dropped the moment the panel closes, so a
 * browser extension reading the page or the site's storage sees an empty chat.
 */
export function StudyMode({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [draft, setDraft] = useState("");
  /** Collapsed to a small pill, so the panel covers as little as possible. */
  const [minimized, setMinimized] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cooldown = useRef(0);
  const busyRef = useRef(false);
  const pausedRef = useRef(false);
  /** Signature of the page we last read, and the candidate next one. */
  const readSignature = useRef<string | null>(null);
  const pendingSignature = useRef<string | null>(null);
  const settleTicks = useRef(0);
  const inFlight = useRef<Set<AbortController>>(new Set());
  const idRef = useRef(0);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

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
   * Grabs a frame and asks about it. Used by the auto loop and the ask box.
   * `explicit` marks a question the user typed: it runs even while another
   * answer is streaming, and it never falls back to the default prompt.
   */
  const scan = useCallback(
    (question?: string, explicit = false) => {
      const video = videoRef.current;
      if (!video || !streamRef.current) return;
      const asked = question?.trim() ?? "";
      // The auto loop stays quiet while an answer streams; a typed question
      // must not, or "hello" would be dropped on the floor mid-answer.
      if (busyRef.current && !explicit) return;
      if (explicit && !asked) return;

      const attachment = grabFrame(video, "Screen");
      if (!attachment) return;

      cooldown.current = COOLDOWN_TICKS;

      const id = `t${idRef.current++}`;
      const text = asked || "Read this and solve the question on screen.";
      setTurns((prev) =>
        [...prev, { id, question: text, answer: "", shot: attachment.dataUrl }].slice(-MAX_TURNS),
      );
      void ask(attachment, text, id);
    },
    [ask],
  );

  const stopShare = useCallback(() => {
    for (const controller of inFlight.current) controller.abort();
    inFlight.current.clear();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    cooldown.current = 0;
    readSignature.current = null;
    pendingSignature.current = null;
    settleTicks.current = 0;
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
      pendingSignature.current = null;
      settleTicks.current = 0;
      cooldown.current = 0;
      setPaused(false);
      setSharing(true);
    } catch (err) {
      setError(err instanceof CaptureError ? err.message : "Screen sharing could not start.");
    }
  }, [stopShare]);

  // The auto-reader. It samples the screen and asks the vision model about it
  // by itself. A still page is the normal case, so the very first settled page
  // is read even though nothing "changed", and the next page is read when it
  // appears. A page is read once: reads are compared against the last page that
  // was read, which is what stops a noisy screen from being read repeatedly.
  useEffect(() => {
    if (!sharing || paused) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || busyRef.current || pausedRef.current) return;
      const signature = frameSignature(video);
      if (!signature || isBlankSignature(signature)) return;

      const read = readSignature.current;
      // Identical to the page already answered: nothing to do.
      if (read && signatureDistance(signature, read) < CHANGE_THRESHOLD) {
        pendingSignature.current = null;
        settleTicks.current = 0;
        return;
      }
      // Back off after a read, so the answer's own repaint is not read as new.
      if (cooldown.current > 0) {
        cooldown.current -= 1;
        return;
      }
      // A new page: hold it and wait for it to stop moving, so a half-scrolled
      // or still-loading page is not read mid-flight.
      const pending = pendingSignature.current;
      if (!pending || signatureDistance(signature, pending) >= CHANGE_THRESHOLD) {
        pendingSignature.current = signature;
        settleTicks.current = 1;
        return;
      }
      settleTicks.current += 1;
      // Read once it holds still, or anyway after a while so a page with a
      // looping animation in the corner cannot stall the reader forever.
      if (settleTicks.current < SETTLE_TICKS && settleTicks.current < MAX_SETTLE_TICKS) return;

      readSignature.current = signature;
      pendingSignature.current = null;
      settleTicks.current = 0;
      scan();
    }, WATCH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [sharing, paused, scan]);

  // Releasing the stream on unmount stops the browser's sharing indicator.
  useEffect(() => stopShare, [stopShare]);

  const popOut = useCallback(async () => {
    if (pipWindow) return;
    const api = pipApi();
    if (!api) {
      setError("This browser cannot float the panel. It stays in this tab instead.");
      return;
    }
    try {
      const pip = await api.requestWindow({ width: 420, height: 580 });
      copyStyles(document, pip.document);
      pip.document.body.className = document.body.className;
      pip.addEventListener("pagehide", () => setPipWindow(null));
      setPipWindow(pip);
    } catch {
      setError("The floating window was blocked. It stays in this tab instead.");
    }
  }, [pipWindow]);

  useEffect(() => {
    if (!pipWindow) return;
    const sync = () => copyStyles(document, pipWindow.document);
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [pipWindow]);

  const close = useCallback(() => {
    pipWindow?.close();
    setPipWindow(null);
    stopShare();
    setTurns([]);
    setAskOpen(false);
    setDraft("");
    onClose();
  }, [pipWindow, stopShare, onClose]);

  if (!open) return null;

  const collapsed = minimized && !pipWindow;

  const panel = (
    <div
      className={`study-panel ${pipWindow ? "study-floating" : ""} ${collapsed ? "study-mini" : ""}`}
      aria-label="Study mode"
    >
      <div className="study-head">
        <ScreenIcon className="h-4 w-4 text-ink-700" />
        <span className="text-[0.875rem] font-medium text-ink-900">Study mode</span>
        {sharing && (
          <span className="study-status">
            {paused ? "Paused" : busy ? "Reading…" : "Reading your screen"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {sharing && (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Resume" : "Pause"}
              title={paused ? "Resume" : "Pause"}
              className="icon-button h-7 w-7"
            >
              {paused ? <PlayGlyph /> : <PauseIcon className="h-3.5 w-3.5" />}
            </button>
          )}
          {!pipWindow && (
            <button
              type="button"
              onClick={() => setMinimized((m) => !m)}
              aria-label={minimized ? "Expand" : "Minimize"}
              title={minimized ? "Expand" : "Minimize"}
              className="icon-button h-7 w-7"
            >
              {minimized ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
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

      {!collapsed && error && <p className="study-error">{error}</p>}

      {!collapsed && (
        <div className="study-thread">
          {!sharing ? (
            <div className="study-placeholder">
              <ScreenIcon className="h-5 w-5" />
              <p className="mt-2 max-w-[16rem] text-center text-[0.8125rem] text-ink-600">
                {canCaptureScreen()
                  ? "Share your screen and open the assignment. It reads each new page for you."
                  : "Screen sharing is not available in this browser."}
              </p>
              <button
                type="button"
                onClick={() => void beginShare()}
                disabled={!canCaptureScreen()}
                className="study-btn study-btn-primary mt-3"
              >
                <ScreenIcon className="h-4 w-4" />
                Share screen
              </button>
            </div>
          ) : turns.length === 0 ? (
            <p className="study-hint">Watching your screen. Answers appear here on their own.</p>
          ) : (
            turns.map((t) => <TurnView key={t.id} turn={t} />)
          )}
        </div>
      )}

      {!collapsed && sharing && (
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

      <video ref={videoRef} playsInline muted aria-hidden className="hidden" />
    </div>
  );

  return pipWindow ? createPortal(panel, pipWindow.document.body) : panel;
}

function TurnView({ turn }: { turn: Turn }) {
  return (
    <div className="study-turn">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={turn.shot} alt="" className="study-thumb" />
      <div className="study-turn-body">
        {turn.error ? (
          <p className="study-error">{turn.error}</p>
        ) : turn.answer.trim() ? (
          <div className="study-answer">
            <Markdown>{turn.answer}</Markdown>
          </div>
        ) : (
          <p className="study-thinking">
            <span className="study-dot" />
            Reading…
          </p>
        )}
      </div>
    </div>
  );
}

/** Inline play triangle for the resume control. */
function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-3.5 w-3.5">
      <path d="M8 5.6c0-.8.9-1.3 1.6-.9l8.3 5.5c.6.4.6 1.3 0 1.7l-8.3 5.5c-.7.4-1.6-.1-1.6-.9Z" />
    </svg>
  );
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
