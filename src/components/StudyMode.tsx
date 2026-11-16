"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Attachment, ChatMessage } from "@/lib/types";
import { ChatError, streamChat } from "@/lib/api";
import { routeFor } from "@/lib/models";
import {
  AudioRecorder,
  CaptureError,
  canCaptureScreen,
  canRecordAudio,
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
/** How often the shared screen is sampled for a page change, in ms. */
const WATCH_TICK_MS = 1200;
/**
 * Above this fraction of changed cells the screen counts as a different page.
 * Calibrated on a worksheet: a moving cursor measures about 0.002 and a
 * replaced question about 0.009, so this sits clear of both.
 */
const PAGE_CHANGE_THRESHOLD = 0.005;
/** Two samples this close together are treated as the same settled page. */
const SETTLED_THRESHOLD = 0.003;

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
  /** Records the shared stream's sound, when the browser gave us a track. */
  const audioRef = useRef<AudioRecorder | null>(null);
  /** Set once the user turns listening on, so a share without audio is visible. */
  const [listen, setListen] = useState(false);
  const [hasAudioTrack, setHasAudioTrack] = useState(false);

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
      // The shared screen's sound, when the user turned listening on. It is
      // stopped here so each clip is what was said since the last question.
      const clip = audioRef.current ? await audioRef.current.stop() : null;
      const attachments = clip ? [attachment, clip] : [attachment];
      const { model } = routeFor({
        hasImages: true,
        hasAudio: Boolean(clip),
        prompt: question,
      });
      const history: ChatMessage[] = [
        { id, role: "user", content: question, attachments, createdAt: Date.now() },
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
      // Listening resumes for the next question, so nothing said in between is
      // lost and the recorder is not left running across turns.
      audioRef.current?.start();
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

      // A frame that is one flat colour is the black gap before a share paints.
      // Reading it costs a call and comes back as "there is nothing here", so
      // it is skipped. A typed question is still honoured, since the user may
      // be looking at a genuinely dark page.
      const sig = frameSignature(video);
      if (!explicit && sig && isBlankSignature(sig)) return;

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
    // Stopping the recorder first releases its track cleanly.
    void audioRef.current?.stop();
    audioRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    readSignature.current = null;
    setHasAudioTrack(false);
    setSharing(false);
    setBusy(false);
  }, []);

  const beginShare = useCallback(async () => {
    setError(null);
    try {
      // Ask for the shared surface's sound only when the user has listening on,
      // so a normal share never prompts for something they did not want.
      const stream = await startScreenShare({ audio: listen });
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const audioTracks = stream.getAudioTracks();
      setHasAudioTrack(audioTracks.length > 0);
      if (audioTracks.length > 0 && canRecordAudio()) {
        const recorder = new AudioRecorder(new MediaStream(audioTracks));
        recorder.start();
        audioRef.current = recorder;
      }

      await primeVideo(stream, video);
      stream.getVideoTracks()[0]?.addEventListener("ended", stopShare);
      readSignature.current = null;
      setElapsed(0);
      setSharing(true);
    } catch (err) {
      setError(err instanceof CaptureError ? err.message : "Screen sharing could not start.");
    }
  }, [listen, stopShare]);

  /**
   * Re-attaches the live stream after the panel moves into the floating window.
   *
   * Opening the float re-parents the panel into the picture-in-picture
   * document, which adopts the `<video>` into that document and detaches its
   * stream. The element is left paused with a zero-sized frame, so the stage
   * renders as a black rectangle and `grabFrame` gets nothing. Handing the same
   * stream to the freshly mounted element restores both.
   */
  useEffect(() => {
    if (!pipWindow) return;
    const stream = streamRef.current;
    if (!stream) return;

    let cancelled = false;
    void (async () => {
      const video = videoRef.current;
      if (!video || cancelled) return;
      try {
        await primeVideo(stream, video);
      } catch {
        if (!cancelled) setError("The floating window lost the screen. Share again.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pipWindow]);

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

  /**
   * Watches the shared screen and reads a new page on its own.
   *
   * The screen is sampled on a slow timer and compared against the signature of
   * the last page that was read. A change has to hold for two samples before it
   * counts, so a cursor, a scroll or a video frame does not trigger a read. The
   * whole page is never kept: only a 16x16 greyscale fingerprint of what was
   * last read, which lives in a ref and is dropped when the share stops.
   */
  useEffect(() => {
    if (!open || !sharing) return;

    let candidate: string | null = null;
    let candidateHits = 0;

    const timer = window.setInterval(() => {
      // Wait for the current answer before looking again. Crucially the
      // signature is not updated while busy, so a page that changes mid-answer
      // is read once the answer finishes rather than being consumed unseen.
      if (busyRef.current) return;

      const video = videoRef.current;
      if (!video) return;
      const sig = frameSignature(video);
      if (!sig) return;
      // The black gap before a share paints, and any flat page, are not pages.
      if (isBlankSignature(sig)) return;

      // Nothing read yet: read what is on screen now.
      if (readSignature.current === null) {
        readSignature.current = sig;
        scan();
        return;
      }

      const distance = signatureDistance(sig, readSignature.current);
      if (distance < PAGE_CHANGE_THRESHOLD) {
        candidate = null;
        candidateHits = 0;
        return;
      }

      // A change has to be seen twice running before it is believed.
      if (candidate && signatureDistance(sig, candidate) < SETTLED_THRESHOLD) {
        candidateHits++;
      } else {
        candidate = sig;
        candidateHits = 1;
        return;
      }

      if (candidateHits >= 2) {
        readSignature.current = sig;
        candidate = null;
        candidateHits = 0;
        scan();
      }
    }, WATCH_TICK_MS);

    return () => window.clearInterval(timer);
  }, [open, sharing, scan]);

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
                {canCaptureScreen() && canRecordAudio() && (
                  <label className="study-listen">
                    <input
                      type="checkbox"
                      checked={listen}
                      onChange={(e) => setListen(e.target.checked)}
                    />
                    <span>Also listen to the audio</span>
                  </label>
                )}
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
            {sharing && listen && !hasAudioTrack && (
              <span className="study-veil study-veil-paused" style={{ left: "auto", right: "0.6rem" }}>
                <span className="study-veil-dot" />
                No audio in this share
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
