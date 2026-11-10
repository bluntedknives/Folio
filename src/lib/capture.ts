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

/** Grid used for change detection. Small enough to compare cheaply. */
const SIGNATURE_EDGE = 16;

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
 */
export async function startScreenShare(): Promise<MediaStream> {
  if (!canCaptureScreen()) {
    throw new CaptureError("This browser cannot share a screen. Try Chrome or Edge.");
  }
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 8 },
      audio: false,
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
 * How different two signatures are, 0 (identical) to 1 (unrelated). A small
 * threshold keeps cursor movement and video playback from triggering a scan.
 */
export function signatureDistance(a: string, b: string): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a.charCodeAt(i) - b.charCodeAt(i));
  }
  return diff / (a.length * 255);
}
