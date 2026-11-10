"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Attachment, ChatMessage } from "@/lib/types";
import {
  CaptureError,
  canCaptureScreen,
  frameSignature,
  grabFrame,
  pipApi,
  primeVideo,
  signatureDistance,
  startScreenShare,
} from "@/lib/capture";
import { Markdown } from "./Markdown";
import { PlayIcon, PopOutIcon, ScreenIcon, SendIcon, StopIcon, XIcon } from "./icons";

/** How often the auto-scanner samples the shared screen. */
const WATCH_INTERVAL_MS = 1500;
/** Minimum signature change before an auto-scan fires. */
const CHANGE_THRESHOLD = 0.02;
/** Frames to skip after a scan, so the answer does not re-trigger on itself. */
const COOLDOWN_TICKS = 6;

type Mode = "idle" | "sharing";

/**
 * Study mode. Share a screen, window or tab and the chat floats on top of it
 * as a Document Picture-in-Picture window, so it stays visible while the
 * assignment is open in another tab or app.
 *
 * The Play button grabs the current frame and asks the vision model about it.
 * Watch keeps sampling and asks again whenever the screen changes, which is
 * the "it reads the question off the page" behaviour.
 */
export function StudyMode({
  open,
  onClose,
  messages,
  streaming,
  onAsk,
  onStop,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  streaming: boolean;
  onAsk: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
}) {
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [watching, setWatching] = useState(false);
  const [shot, setShot] = useState<Attachment | null>(null);
  const [draft, setDraft] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastSignature = useRef<string | null>(null);
  const cooldown = useRef(0);
  const streamingRef = useRef(streaming);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  const supported = useMemo(() => canCaptureScreen(), []);

  /** Releases the stream and stops any watch loop. */
  const stopShare = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    lastSignature.current = null;
    cooldown.current = 0;
    setWatching(false);
    setMode("idle");
    setShot(null);
  }, []);

  async function beginShare() {
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
      // The browser's own "Stop sharing" bar ends the track directly.
      stream.getVideoTracks()[0]?.addEventListener("ended", stopShare);
      lastSignature.current = frameSignature(video);
      setMode("sharing");
    } catch (err) {
      setError(err instanceof CaptureError ? err.message : "Screen sharing could not start.");
    }
  }

  /** Grabs a frame and asks the model about it. */
  const scan = useCallback(
    (question?: string) => {
      const video = videoRef.current;
      if (!video || !streamRef.current) return;
      const attachment = grabFrame(video, "Screen");
      if (!attachment) return;
      lastSignature.current = frameSignature(video);
      cooldown.current = COOLDOWN_TICKS;
      setShot(attachment);
      onAsk(question?.trim() || "Read this and solve the question on screen.", [attachment]);
    },
    [onAsk],
  );

  // Watch loop: sample the screen and scan when it settles on something new.
  useEffect(() => {
    if (!watching || mode !== "sharing") return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || streamingRef.current) return;
      if (cooldown.current > 0) {
        cooldown.current -= 1;
        return;
      }
      const signature = frameSignature(video);
      if (!signature) return;
      const previous = lastSignature.current;
      if (previous && signatureDistance(previous, signature) < CHANGE_THRESHOLD) return;
      scan();
    }, WATCH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [watching, mode, scan]);

  // Tear the stream down when the component unmounts.
  useEffect(() => stopShare, [stopShare]);

  // Pop the panel into an always-on-top window. This is the piece that lets
  // the chat float over the assignment, whatever tab or app it is in.
  const popOut = useCallback(async () => {
    if (pipWindow) return;
    const api = pipApi();
    if (!api) {
      setError("This browser cannot float the panel. It stays in this tab instead.");
      return;
    }
    try {
      const pip = await api.requestWindow({ width: 420, height: 560 });
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
    // Keep the theme in step when the toggle flips in the main tab.
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [pipWindow]);

  const close = useCallback(() => {
    pipWindow?.close();
    setPipWindow(null);
    stopShare();
    onClose();
  }, [pipWindow, stopShare, onClose]);

  if (!open) return null;

  const panel = (
    <StudyPanel
      mode={mode}
      error={error}
      supported={supported}
      shot={shot}
      watching={watching}
      streaming={streaming}
      messages={messages}
      draft={draft}
      canPopOut={Boolean(pipApi()) && !pipWindow}
      floating={Boolean(pipWindow)}
      onDraft={setDraft}
      onShare={() => void beginShare()}
      onScan={() => scan(draft)}
      onToggleWatch={() => setWatching((w) => !w)}
      onStop={onStop}
      onPopOut={() => void popOut()}
      onClose={close}
    />
  );

  return (
    <>
      {/* The live feed the frames are drawn from. Never shown. */}
      <video ref={videoRef} playsInline muted aria-hidden className="hidden" />
      {pipWindow ? createPortal(panel, pipWindow.document.body) : panel}
    </>
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

function StudyPanel({
  mode,
  error,
  supported,
  shot,
  watching,
  streaming,
  messages,
  draft,
  canPopOut,
  floating,
  onDraft,
  onShare,
  onScan,
  onToggleWatch,
  onStop,
  onPopOut,
  onClose,
}: {
  mode: Mode;
  error: string | null;
  supported: boolean;
  shot: Attachment | null;
  watching: boolean;
  streaming: boolean;
  messages: ChatMessage[];
  draft: string;
  canPopOut: boolean;
  floating: boolean;
  onDraft: (v: string) => void;
  onShare: () => void;
  onScan: () => void;
  onToggleWatch: () => void;
  onStop: () => void;
  onPopOut: () => void;
  onClose: () => void;
}) {
  const thread = useMemo(() => recentExchange(messages), [messages]);
  const sharing = mode === "sharing";

  return (
    <div className={`study-panel ${floating ? "study-floating" : ""}`} aria-label="Study mode">
      <div className="study-head">
        <ScreenIcon className="h-4 w-4 text-ink-700" />
        <span className="text-[0.875rem] font-medium text-ink-900">Study mode</span>
        {sharing && <span className="study-live" title="Sharing your screen" />}
        <div className="ml-auto flex items-center gap-1">
          {canPopOut && (
            <button
              type="button"
              onClick={onPopOut}
              aria-label="Float on top"
              title="Float on top of other windows"
              className="icon-button h-7 w-7"
            >
              <PopOutIcon className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close study mode"
            title="Close"
            className="icon-button h-7 w-7"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="study-stage">
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.dataUrl} alt="Captured screen" className="study-shot" />
        ) : (
          <div className="study-placeholder">
            <ScreenIcon className="h-5 w-5" />
            <p className="mt-2 max-w-[16rem] text-center text-[0.8125rem] text-ink-600">
              {supported
                ? "Share your screen, open the assignment, then press Play."
                : "Screen sharing is not available in this browser."}
            </p>
          </div>
        )}
        {watching && <span className="study-watch-badge">Watching</span>}
      </div>

      {error && <p className="study-error">{error}</p>}

      <div className="study-controls">
        {!sharing ? (
          <button
            type="button"
            onClick={onShare}
            disabled={!supported}
            className="study-btn study-btn-primary"
          >
            <ScreenIcon className="h-4 w-4" />
            Share screen
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onScan}
              disabled={streaming}
              aria-label="Play"
              title="Read the screen and answer"
              className="study-btn study-btn-primary"
            >
              <PlayIcon className="h-4 w-4" />
              Play
            </button>
            <button
              type="button"
              onClick={onToggleWatch}
              aria-pressed={watching}
              className={`study-btn ${watching ? "study-btn-on" : ""}`}
            >
              {watching ? "Watching" : "Watch"}
            </button>
          </>
        )}
      </div>

      {sharing && (
        <div className="study-ask">
          <input
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onScan();
              }
            }}
            placeholder="Ask about what is on screen…"
            aria-label="Question about the screen"
            className="study-input"
          />
          {streaming ? (
            <button type="button" onClick={onStop} aria-label="Stop" className="study-send">
              <StopIcon className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onScan}
              aria-label="Send"
              disabled={!draft.trim()}
              className="study-send study-send-active"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div className="study-thread">
        {thread.length === 0 ? (
          <p className="study-hint">Answers appear here as you scan.</p>
        ) : (
          thread.map((m) => <StudyTurn key={m.id} message={m} />)
        )}
      </div>
    </div>
  );
}

/** The last question and answer, which is all the overlay needs to show. */
function recentExchange(messages: ChatMessage[]): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant" && messages[i].content.trim()) {
      return messages[i - 1] ? [messages[i - 1], messages[i]] : [messages[i]];
    }
  }
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return lastUser ? [lastUser] : [];
}

function StudyTurn({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <p className="study-question">
        {message.attachments?.length ? "Screen capture" : message.content}
        {message.attachments?.length && message.content ? ` — ${message.content}` : ""}
      </p>
    );
  }
  if (message.error) return <p className="study-error">{message.error}</p>;
  return (
    <div className="study-answer">
      <Markdown>{message.content}</Markdown>
    </div>
  );
}
