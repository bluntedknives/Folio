import type { Attachment } from "./types";
import { dataUrlBytes, stripExtension } from "./pdf";

/**
 * Video handling, entirely in the browser.
 *
 * The file goes to the model as a `video_url` data URL. Before it leaves the
 * page it is passed through a metadata stripper that blanks the container's
 * descriptive fields in place: for MP4/MOV the `udta`, `meta`, `uuid` and
 * `ilst` boxes, for WebM the `Tags` element and the `Title`, `MuxingApp` and
 * `WritingApp` children of `Info`. Both rewrites keep every byte offset
 * identical, so the file still plays and still decodes server-side, but the
 * title, author, comment, creation time and GPS strings are gone.
 *
 * Nothing is re-encoded. Transcoding in the browser was measured and rejected:
 * Chromium's MediaRecorder emits a streaming container with no duration or cue
 * table and the API's content screen refuses it, so the file is sent in the
 * container the student already has.
 */

/** Raw bytes. The API caps a request at 25 MB, and base64 adds a third. */
export const MAX_VIDEO_BYTES = 16 * 1024 * 1024;

export class VideoRejected extends Error {}

const EXT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);

/** True when this file looks like a video we can send. */
export function isVideoFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (VIDEO_TYPES.has(type)) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ext in EXT_TYPES;
}

/** Reads a video into an attachment, stripping metadata on the way through. */
export async function readVideo(file: File, index: number): Promise<Attachment> {
  if (file.size > MAX_VIDEO_BYTES) {
    throw new VideoRejected(
      `That video is ${formatMb(file.size)}. The limit is ${formatMb(MAX_VIDEO_BYTES)}. Trim it, or share the screen in Study mode instead.`,
    );
  }

  const original = new Uint8Array(await file.arrayBuffer());
  const container = detectContainer(original);
  if (!container) {
    throw new VideoRejected(
      `${file.name || "That file"} is not a video I can read. Use MP4, MOV or WebM.`,
    );
  }

  // Blanking is best-effort: an unusual file may have nothing to strip, which
  // is fine, but a file we cannot parse is sent unchanged rather than dropped.
  const cleaned = stripMetadata(original, container);

  const blob = new Blob([cleaned], { type: container === "webm" ? "video/webm" : "video/mp4" });
  const probed = await probe(blob);
  const dataUrl = await blobToDataUrl(blob);

  return {
    kind: "video",
    name: stripExtension(file.name) || `Video ${index + 1}`,
    dataUrl,
    width: probed.width,
    height: probed.height,
    duration: probed.duration,
    hasAudio: hasAudioTrack(cleaned, container),
    poster: probed.poster,
    bytes: dataUrlBytes(dataUrl),
  };
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Container = "mp4" | "webm";

/** Identifies the container from its magic bytes, or null when unknown. */
function detectContainer(bytes: Uint8Array<ArrayBuffer>): Container | null {
  if (bytes.length < 12) return null;
  // MP4/MOV: an `ftyp` box always follows the 4-byte size.
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return "mp4";
  }
  // Matroska/WebM: the EBML header id.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "webm";
  }
  return null;
}

function stripMetadata(bytes: Uint8Array<ArrayBuffer>, container: Container): Uint8Array<ArrayBuffer> {
  try {
    return container === "mp4" ? stripMp4(bytes) : stripWebm(bytes);
  } catch {
    return bytes;
  }
}

/* ------------------------------------------------------------------ MP4 -- */

/** Boxes that carry user or device information. */
const MP4_DROP = new Set(["udta", "meta", "uuid", "ilst"]);

/** Boxes worth descending into to find the above. */
const MP4_CONTAINERS = new Set([
  "moov", "trak", "mdia", "minf", "stbl", "udta", "edts", "dinf", "mvex", "moof", "traf",
]);

/**
 * Renames each metadata box to `free` and zeroes its payload. `free` is a
 * standard box that players skip, and because only the type and contents
 * change, the file length is untouched and every chunk offset in `stco`/`co64`
 * still points at the same place.
 */
function stripMp4(input: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const bytes = input.slice();
  const view = new DataView(bytes.buffer);

  const walk = (start: number, end: number): void => {
    let i = start;
    while (i + 8 <= end) {
      let size = view.getUint32(i);
      const type = ascii(bytes, i + 4, 4);
      let header = 8;
      if (size === 1) {
        if (i + 16 > end) return;
        // 64-bit size.
        size = Number(view.getBigUint64(i + 8));
        header = 16;
      } else if (size === 0) {
        size = end - i;
      }
      if (size < header || i + size > end) return;

      if (MP4_DROP.has(type)) {
        bytes[i + 4] = 0x66; // f
        bytes[i + 5] = 0x72; // r
        bytes[i + 6] = 0x65; // e
        bytes[i + 7] = 0x65; // e
        bytes.fill(0, i + header, i + size);
      } else if (MP4_CONTAINERS.has(type)) {
        walk(i + header, i + size);
      }
      i += size;
    }
  };

  walk(0, bytes.length);
  return bytes;
}

/** True when an MP4/MOV track declares a sound handler. */
function mp4HasAudio(input: Uint8Array<ArrayBuffer>): boolean {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let found = false;

  const walk = (start: number, end: number): void => {
    let i = start;
    while (i + 8 <= end && !found) {
      let size = view.getUint32(i);
      const type = ascii(input, i + 4, 4);
      let header = 8;
      if (size === 1) {
        if (i + 16 > end) return;
        size = Number(view.getBigUint64(i + 8));
        header = 16;
      } else if (size === 0) {
        size = end - i;
      }
      if (size < header || i + size > end) return;

      if (type === "hdlr" && i + header + 12 <= end) {
        // version+flags (4), pre_defined (4), then handler_type.
        if (ascii(input, i + header + 8, 4) === "soun") found = true;
      } else if (MP4_CONTAINERS.has(type)) {
        walk(i + header, i + size);
      }
      i += size;
    }
  };

  walk(0, input.length);
  return found;
}

/* ----------------------------------------------------------------- WebM -- */

/**
 * Replaces a metadata element with a `Void` element of exactly the same length,
 * so every `SeekHead` and `Cues` offset in the file stays valid. `Void` is
 * Matroska's designated filler and is ignored by demuxers.
 */
function webmBlank(bytes: Uint8Array<ArrayBuffer>, at: number, total: number): void {
  // 1-byte id, then a size vint wide enough to describe the rest.
  let width = 1;
  while (width <= 8 && (1 << (7 * width)) - 1 < total - 1 - width) width++;
  if (width > 8) return;
  const payload = total - 1 - width;
  if (payload < 0) return;

  bytes[at] = 0xec; // Void
  for (let k = 0; k < width; k++) {
    bytes[at + 1 + k] = (payload >> (8 * (width - 1 - k))) & 0xff;
  }
  bytes[at + 1] |= 0x80 >> (width - 1);
  bytes.fill(0, at + 1 + width, at + total);
}

const WEBM_CONTAINERS = new Set([
  0x18538067, // Segment
  0x1549a966, // Info
  0x1f43b675, // Cluster
  0x1654ae6b, // Tracks
  0x1c53bb6b, // Cues
  0x114d9b74, // SeekHead
]);
const WEBM_TAGS = 0x1254c367;
const WEBM_INFO = 0x1549a966;
const WEBM_TITLE = 0x7ba9;
const WEBM_MUXING_APP = 0x4d80;
const WEBM_WRITING_APP = 0x5741;
const WEBM_TRACK_ENTRY = 0xae;
const WEBM_TRACK_TYPE = 0x83;

/** Reads an EBML element id (already length-prefixed in the stream). */
function readId(bytes: Uint8Array<ArrayBuffer>, at: number): { id: number; length: number } | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (!(first & mask)) {
    mask >>= 1;
    length++;
    if (length > 4) return null;
  }
  if (at + length > bytes.length) return null;
  let id = 0;
  for (let k = 0; k < length; k++) id = id * 256 + bytes[at + k];
  return { id, length };
}

/** Reads an EBML size vint and its width. */
function readSize(bytes: Uint8Array<ArrayBuffer>, at: number): { value: number; length: number } | null {
  const first = bytes[at];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (!(first & mask)) {
    mask >>= 1;
    length++;
    if (length > 8) return null;
  }
  if (at + length > bytes.length) return null;
  let value = first & (mask - 1);
  for (let k = 1; k < length; k++) value = value * 256 + bytes[at + k];
  return { value, length };
}

/** True when the value vint is the "unknown size" sentinel. */
function isUnknownSize(bytes: Uint8Array<ArrayBuffer>, at: number, size: number, length: number): boolean {
  if (bytes[at] === undefined) return false;
  const allOnes = (1 << (7 * length)) - 1;
  return size === allOnes;
}

function stripWebm(input: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const bytes = input.slice();

  const walk = (start: number, end: number, parent: number): void => {
    let at = start;
    while (at < end) {
      const id = readId(bytes, at);
      if (!id) return;
      const size = readSize(bytes, at + id.length);
      if (!size) return;
      const header = id.length + size.length;
      const dataStart = at + header;
      const dataEnd = isUnknownSize(bytes, at + id.length, size.value, size.length)
        ? end
        : dataStart + size.value;
      if (dataEnd > end || dataEnd <= at) return;

      const isMetadata =
        id.id === WEBM_TAGS ||
        (parent === WEBM_INFO &&
          (id.id === WEBM_TITLE || id.id === WEBM_MUXING_APP || id.id === WEBM_WRITING_APP));

      if (isMetadata) {
        webmBlank(bytes, at, dataEnd - at);
      } else if (WEBM_CONTAINERS.has(id.id) || id.id === WEBM_TRACK_ENTRY) {
        walk(dataStart, dataEnd, id.id);
      }
      at = dataEnd;
    }
  };

  walk(0, bytes.length, 0);
  return bytes;
}

/** True when a WebM TrackEntry declares an audio track (TrackType 2). */
function webmHasAudio(input: Uint8Array<ArrayBuffer>): boolean {
  let found = false;

  const walk = (start: number, end: number, inTrack: boolean): void => {
    let at = start;
    while (at < end && !found) {
      const id = readId(input, at);
      if (!id) return;
      const size = readSize(input, at + id.length);
      if (!size) return;
      const header = id.length + size.length;
      const dataStart = at + header;
      const dataEnd = isUnknownSize(input, at + id.length, size.value, size.length)
        ? end
        : dataStart + size.value;
      if (dataEnd > end || dataEnd <= at) return;

      if (inTrack && id.id === WEBM_TRACK_TYPE && dataStart < dataEnd) {
        if (input[dataStart] === 2) found = true;
      } else if (WEBM_CONTAINERS.has(id.id) || id.id === WEBM_TRACK_ENTRY) {
        walk(dataStart, dataEnd, id.id === WEBM_TRACK_ENTRY);
      }
      at = dataEnd;
    }
  };

  walk(0, input.length, false);
  return found;
}

function hasAudioTrack(bytes: Uint8Array<ArrayBuffer>, container: Container): boolean {
  try {
    return container === "mp4" ? mp4HasAudio(bytes) : webmHasAudio(bytes);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- probe -- */

interface Probed {
  duration: number;
  width: number;
  height: number;
  poster: string;
}

/**
 * Reads the duration and dimensions from the file itself, and grabs one frame
 * to use as a thumbnail. A failure here is not fatal: the video is still
 * sendable, so the fields come back empty rather than throwing.
 */
async function probe(blob: Blob): Promise<Probed> {
  const empty: Probed = { duration: 0, width: 0, height: 0, poster: "" };
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await event(video, "loadedmetadata", 8000);
    const width = video.videoWidth;
    const height = video.videoHeight;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;

    // A tenth of the way in usually clears a title card, but stay off the very
    // end where the frame may be black.
    const at = duration > 0 ? Math.min(Math.max(duration * 0.1, 0.1), Math.max(duration - 0.1, 0)) : 0;
    if (at > 0) {
      video.currentTime = at;
      await event(video, "seeked", 4000);
    }
    return { duration, width, height, poster: posterFrom(video) };
  } catch {
    return empty;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Draws the video's current frame to a small JPEG. */
function posterFrom(video: HTMLVideoElement): string {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return "";

  const edge = 480;
  const scale = Math.min(1, edge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.7);
}

/** Resolves on an event, or after `ms`, whichever comes first. */
function event(target: HTMLVideoElement, name: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      window.clearTimeout(timer);
      target.removeEventListener(name, done);
      target.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      window.clearTimeout(timer);
      target.removeEventListener(name, done);
      target.removeEventListener("error", fail);
      reject(new VideoRejected("That video could not be read."));
    };
    const timer = window.setTimeout(fail, ms);
    target.addEventListener(name, done, { once: true });
    target.addEventListener("error", fail, { once: true });
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new VideoRejected("That video could not be read."));
    reader.readAsDataURL(blob);
  });
}

/** Reads `length` bytes as ASCII, for box type comparisons. */
function ascii(bytes: Uint8Array<ArrayBuffer>, at: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[at + i] ?? 0);
  return out;
}
