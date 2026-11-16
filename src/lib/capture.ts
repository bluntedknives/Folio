import type { Attachment } from "./types";
import { dataUrlBytes } from "./pdf";

/**
 * Screen capture for Study mode. The user shares a screen, window or tab, and
 * this module turns the live video into stills the vision model can read.
 *
 * Every frame goes through a canvas, exactly like an uploaded image, so it is
 * re-encoded from raw pixels. Nothing from the source window (EXIF, window
 * titles, file paths) can survive into the bytes we send.
 */

/** Longest edge of a captured frame. Matches the upload pipeline. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.86;

/**
 * Grid used for change detection. Small enough to compare cheaply, but fine
 * enough that a line of text is not averaged away. Measured on a worksheet:
 * 16x16 could not tell two different questions apart, 64x64 separates them
 * cleanly from a moving cursor.
 */
const SIGNATURE_EDGE = 64;

export interface Frame {
  dataUrl: string;
  width: number;
  height: number;
}

/** Document Picture-in-Picture, which TypeScript's DOM lib does not know yet. */
interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}

/** The PiP entry point, or null where the browser has not shipped it. */
export function pipApi(): DocumentPictureInPicture | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { documentPictureInPicture?: DocumentPictureInPicture })
    .documentPictureInPicture ?? null;
}

export class CaptureError extends Error {}

/** True when the browser can share a screen at all. */
export function canCaptureScreen(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/**
 * Asks the user to pick something to share. The picker is browser UI, so this
 * must be called from a user gesture. Throws `CaptureError` with a readable
 * message when they cancel or the platform refuses.
 *
 * `audio` asks for the shared surface's sound as well. Only Chromium offers it,
 * and only for a tab or the whole screen, so a refusal there is not an error:
 * the video track is still usable and the caller checks what came back.
 */
export async function startScreenShare({ audio = false }: { audio?: boolean } = {}): Promise<MediaStream> {
  if (!canCaptureScreen()) {
    throw new CaptureError("This browser cannot share a screen. Try Chrome or Edge.");
  }
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 8 },
      audio,
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError") throw new CaptureError("Screen sharing was cancelled.");
    if (name === "NotReadableError") {
      throw new CaptureError("The screen could not be read. Another app may be capturing it.");
    }
    throw new CaptureError("Screen sharing could not start.");
  }
}

/** True when the browser can record audio at all. */
export function canRecordAudio(): boolean {
  return typeof MediaRecorder !== "undefined";
}

/**
 * Records the audio track of a shared stream into a clip the model can listen
 * to. The recorder is stopped between questions and started again, so each clip
 * is "what was said since the last thing you asked".
 */
export class AudioRecorder {
  private recorder: MediaRecorder;
  private chunks: BlobPart[] = [];

  constructor(stream: MediaStream) {
    const mime = pickAudioMime();
    this.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
  }

  get running(): boolean {
    return this.recorder.state === "recording";
  }

  start(): void {
    if (this.recorder.state === "inactive") this.recorder.start();
  }

  /**
   * Stops and resolves with the clip, or null when nothing usable was captured.
   * A very short clip is dropped: it is usually silence, and sending it costs a
   * round trip for nothing.
   */
  async stop(): Promise<Attachment | null> {
    if (this.recorder.state === "inactive") return null;

    const done = new Promise<void>((resolve) => {
      this.recorder.addEventListener("stop", () => resolve(), { once: true });
    });
    this.recorder.stop();
    await done;

    const blob = new Blob(this.chunks, { type: this.recorder.mimeType || "audio/webm" });
    this.chunks = [];
    if (blob.size < MIN_AUDIO_BYTES) return null;

    const dataUrl = await blobToDataUrl(blob);
    return {
      kind: "audio",
      name: "Screen audio",
      dataUrl,
      bytes: dataUrlBytes(dataUrl),
    };
  }
}

/** The first audio container this browser will actually record. */
function pickAudioMime(): string {
  for (const candidate of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

/** Clips under this are treated as silence and not sent. */
const MIN_AUDIO_BYTES = 2048;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("The audio clip could not be read."));
    reader.readAsDataURL(blob);
  });
}

/** Attaches a stream to a muted video element and waits for the first frame. */
export async function primeVideo(stream: MediaStream, video: HTMLVideoElement): Promise<void> {
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => {
      video.addEventListener("loadeddata", () => resolve(), { once: true });
    });
  }
}

/**
 * Copies the current video frame into an `Attachment`, scaled to `MAX_EDGE`
 * and encoded as JPEG. The canvas re-encode is what drops metadata.
 */
export function grabFrame(video: HTMLVideoElement, name = "Screen"): Attachment | null {
  const frame = drawFrame(video);
  if (!frame) return null;
  return {
    kind: "image",
    name,
    dataUrl: frame.dataUrl,
    width: frame.width,
    height: frame.height,
    bytes: dataUrlBytes(frame.dataUrl),
  };
}

/** Draws the current frame to a canvas and returns it as a JPEG data URL. */
export function drawFrame(video: HTMLVideoElement): Frame | null {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  // Flatten onto white: a shared window may have transparent regions.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(video, 0, 0, width, height);

  return { dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY), width, height };
}

/**
 * Cheap perceptual signature of the current frame: a 16x16 greyscale grid.
 * Used to notice that the shared screen changed without keeping full frames.
 */
export function frameSignature(video: HTMLVideoElement): string | null {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return null;

  const canvas = document.createElement("canvas");
  canvas.width = SIGNATURE_EDGE;
  canvas.height = SIGNATURE_EDGE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, SIGNATURE_EDGE, SIGNATURE_EDGE);

  const { data } = ctx.getImageData(0, 0, SIGNATURE_EDGE, SIGNATURE_EDGE);
  let out = "";
  for (let i = 0; i < data.length; i += 4) {
    const grey = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    out += String.fromCharCode(grey);
  }
  return out;
}

/**
 * How different two signatures are, 0 (identical) to 1 (unrelated).
 *
 * This is the fraction of cells that changed by a visible amount, not the mean
 * difference. The mean is useless for a document: text is dark ink on white, so
 * replacing a whole line of it moves the average of the grid by a thousandth.
 * Counting changed cells instead makes a new page obvious while still ignoring
 * a cursor or a repainted antialiasing edge.
 *
 * Measured on a worksheet at 64x64: two samples of the same page differ by
 * 0.0000, moving the cursor by 0.0020, and replacing the questions by 0.0088.
 */
export function signatureDistance(a: string, b: string): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a.charCodeAt(i) - b.charCodeAt(i)) > CELL_DELTA) changed++;
  }
  return changed / a.length;
}

/** Greyscale difference within one cell that counts as a real change. */
const CELL_DELTA = 12;

/**
 * True when a frame is a single flat colour, which is what the screen looks
 * like for the first moments of a share. Reading one wastes a call and comes
 * back as "there is nothing here", so it is worth skipping. Works off the
 * signature, so it costs no extra pixel read.
 */
export function isBlankSignature(signature: string): boolean {
  if (!signature) return true;
  let min = 255;
  let max = 0;
  for (let i = 0; i < signature.length; i++) {
    const grey = signature.charCodeAt(i);
    if (grey < min) min = grey;
    if (grey > max) max = grey;
  }
  return max - min < 10;
}
