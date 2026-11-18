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
  // Already showing this stream: a second play() would race the first and
  // reject with AbortError, which callers would report as a failure.
  if (video.srcObject === stream && video.readyState >= 2) return;

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  if (video.readyState < 2) {
    // Bounded, because a frame that never arrives would otherwise leave the
    // caller awaiting forever and the UI stuck before it ever reports "live".
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        video.removeEventListener("loadeddata", done);
        resolve();
      };
      const timer = setTimeout(done, 3000);
      video.addEventListener("loadeddata", done, { once: true });
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

/** Greyscale difference within one cell that counts as a real change. */
const CELL_DELTA = 12;

/** Grid edge, as an integer, for the alignment below. */
const SIG_EDGE = 64;

/**
 * Rows the two grids must still share before a shifted match means anything.
 *
 * Scrolling can move any distance, so the offset is searched across the whole
 * height rather than a fixed window. A quarter of the rows shared is enough for
 * a match to be believed; past that, almost none of the page is in common and
 * the two frames are different pages by any useful definition.
 */
const MIN_SHARED_ROWS = 16;

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
 *
 * Scrolling is the awkward case, because it translates the whole page and a
 * cell-for-cell comparison then reports every cell as changed. The frames are
 * therefore compared at every vertical offset and the closest alignment wins,
 * so a page scrolled to and scrolled back from measures as the same page
 * whatever the distance moved. Offsets are tried nearest-first, so the usual
 * case of an unchanged page is settled by the first comparison.
 *
 * The scan is exact, not sampled: 97 offsets over at most 4096 cells is well
 * under a millisecond of work, and it runs on a slow timer beside a frame
 * capture that already touches every pixel.
 */
export function signatureDistance(a: string, b: string): number {
  if (a.length !== b.length || a.length === 0) return 1;
  if (a.length !== SIG_EDGE * SIG_EDGE) return directDistance(a, b);

  let best = 1;
  // Nearest offset first, so an unshifted page costs one comparison and the
  // exact-match early exit below fires straight away.
  for (let distance = 0; distance < SIG_EDGE; distance++) {
    for (const shift of distance === 0 ? [0] : [distance, -distance]) {
      const d = shiftedDistance(a, b, shift);
      if (d < best) best = d;
    }
    // An exact match at some offset is the answer; nothing can be closer.
    if (best === 0) break;
  }
  return best;
}

/** Fraction of cells that differ, over the rows the two grids share at `shift`. */
function shiftedDistance(a: string, b: string, shift: number): number {
  const top = Math.max(0, shift);
  const bottom = Math.min(SIG_EDGE, SIG_EDGE + shift);
  if (bottom - top < MIN_SHARED_ROWS) return 1;

  let changed = 0;
  let total = 0;
  for (let row = top; row < bottom; row++) {
    const base = row * SIG_EDGE;
    const other = (row - shift) * SIG_EDGE;
    for (let col = 0; col < SIG_EDGE; col++) {
      if (Math.abs(a.charCodeAt(base + col) - b.charCodeAt(other + col)) > CELL_DELTA) changed++;
      total++;
    }
  }
  return total === 0 ? 1 : changed / total;
}

/** Cell-for-cell distance, for signatures that are not the standard grid. */
function directDistance(a: string, b: string): number {
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a.charCodeAt(i) - b.charCodeAt(i)) > CELL_DELTA) changed++;
  }
  return changed / a.length;
}

/**
 * Distance above which two frames are different pages.
 *
 * Calibrated on a worksheet: a moving cursor measures about 0.002 and a replaced
 * question about 0.009, so this sits clear of both. It lives here beside the
 * distance function because the two are calibrated together and moving one
 * without the other is how the watcher starts reading pages it has already read.
 */
export const PAGE_CHANGE_THRESHOLD = 0.005;

/**
 * How many answered pages are remembered.
 *
 * Scrolling back over work that has been read must not ask about it again, and a
 * student scrolls back often. Only fingerprints are kept, never the frames.
 */
export const RECENT_READS = 8;

/** Appends an answered page, dropping the oldest once the memory is full. */
export function rememberSignature(recent: string[], sig: string): void {
  recent.push(sig);
  if (recent.length > RECENT_READS) recent.splice(0, recent.length - RECENT_READS);
}

/**
 * True when `sig` matches a page already answered, a scroll either way.
 *
 * The comparison is the same translation-tolerant one used to spot a new page,
 * so a page scrolled to a different position still counts as the page that was
 * already read rather than a fresh one. A page that has been scrolled partly
 * off screen is caught by the containment check below.
 */
export function wasSignatureRead(recent: string[], sig: string): boolean {
  // The page usually has not moved at all — the reader scrolled away and back,
  // or is still settling on it — and a direct comparison settles that far more
  // cheaply than the translation search below.
  for (const seen of recent) {
    if (seen.length === sig.length && directDistance(sig, seen) < PAGE_CHANGE_THRESHOLD) return true;
  }
  for (const seen of recent) {
    if (signatureDistance(sig, seen) < PAGE_CHANGE_THRESHOLD) return true;
    if (containsSignature(seen, sig)) return true;
  }
  return false;
}

/** Share of a row's cells that may differ and still count as the same row. */
const ROW_MATCH = 0.06;

/**
 * Matching rows in a row that mean the frame holds a page already read.
 *
 * A student who scrolls down to write leaves the answered question in the top of
 * the frame and a blank writing area below it. Compared whole, that frame differs
 * from the answered page — the writing area sits where the old footer was — so
 * the question looks new and is read a second time. This is the run of rows that
 * counts as the page still being there, set well above a quarter of the grid so
 * that two unrelated questions sharing a header are not mistaken for one page.
 */
const MIN_CONTAINED_ROWS = 24;

/**
 * True when `seen` appears inside `sig` as a run of matching rows.
 *
 * The frame is compared with the answered page at every vertical offset, and a
 * run of matching rows is looked for rather than a match over the whole overlap.
 * That is what lets a page survive being scrolled partly off the top or bottom:
 * the part still on screen still matches, and the rest of the frame is free to
 * be blank, or new writing, without spoiling the match.
 */
export function containsSignature(seen: string, sig: string): boolean {
  const grid = SIG_EDGE * SIG_EDGE;
  if (seen.length !== grid || sig.length !== grid) return false;

  for (let shift = -(SIG_EDGE - 1); shift <= SIG_EDGE - 1; shift++) {
    const top = Math.max(0, shift);
    const bottom = Math.min(SIG_EDGE, SIG_EDGE + shift);
    if (bottom - top < MIN_CONTAINED_ROWS) continue;

    let run = 0;
    for (let row = top; row < bottom; row++) {
      const base = row * SIG_EDGE;
      const other = (row - shift) * SIG_EDGE;
      let changed = 0;
      for (let col = 0; col < SIG_EDGE; col++) {
        if (Math.abs(sig.charCodeAt(base + col) - seen.charCodeAt(other + col)) > CELL_DELTA) changed++;
      }
      if (changed / SIG_EDGE <= ROW_MATCH) {
        run++;
        if (run >= MIN_CONTAINED_ROWS) return true;
      } else {
        run = 0;
      }
    }
  }
  return false;
}

/**
 * One answered turn of a study session, as the panel keeps it.
 */
export interface StudyTurn {
  question: string;
  answer: string;
}

/**
 * The conversation a read is answered in, oldest first.
 *
 * Study mode is one session, not a run of unrelated questions: the page read a
 * minute ago is still in front of the model when the next one is asked about.
 * Each finished turn goes in as its question and the answer it got, so "now do
 * part b" and "why" resolve against what was just discussed rather than the
 * model meeting every page cold. A turn with no answer is skipped, so a failed
 * read does not leave a question dangling with nothing after it.
 */
export function studyHistory(
  turns: StudyTurn[],
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const turn of turns) {
    if (!turn.answer.trim()) continue;
    out.push({ role: "user", content: turn.question });
    out.push({ role: "assistant", content: turn.answer });
  }
  return out;
}

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
