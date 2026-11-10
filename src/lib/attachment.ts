import type { Attachment } from "./types";
import { PdfRejected, dataUrlBytes, readPdf, stripExtension } from "./pdf";

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
export const MAX_PDF_BYTES = 24 * 1024 * 1024;
/** Total attachments allowed on one message. */
export const MAX_ATTACHMENTS = 6;

const MAX_EDGE = 1600;
const MIN_EDGE = 128;
const JPEG_QUALITY = 0.86;

/** Anything the user cannot attach, with the message the UI should show. */
export class AttachmentRejected extends Error {}

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif",
]);

/** Browsers do not decode these, but the model can, so pass them through. */
const PASSTHROUGH_IMAGE_TYPES = new Set(["image/heic", "image/heif"]);

const AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/flac",
  "audio/aac",
]);

/**
 * Routes one file to the right reader. Images are re-encoded (which is what
 * strips metadata), PDFs are rendered page by page, and audio is embedded as-is.
 */
export async function readAttachment(file: File, index: number): Promise<Attachment[]> {
  const type = (file.type || guessType(file.name)).toLowerCase();

  if (type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > MAX_PDF_BYTES) {
      throw new AttachmentRejected(
        `That PDF is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_PDF_BYTES)}.`,
      );
    }
    return readPdf(file);
  }

  if (AUDIO_TYPES.has(type) || type.startsWith("audio/")) {
    return [await readAudio(file)];
  }

  if (IMAGE_TYPES.has(type)) {
    return [await readImage(file, index)];
  }

  if (PASSTHROUGH_IMAGE_TYPES.has(type)) {
    return [await readRawImage(file, index)];
  }

  throw new AttachmentRejected(
    `${file.name || "That file"} is not a format I can read. Use an image, a PDF, or an audio clip.`,
  );
}

/** Reads several files, rejecting the whole batch if any one fails. */
export async function readAttachments(files: File[]): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (let i = 0; i < files.length; i++) {
    out.push(...(await readAttachment(files[i], out.length + i)));
  }
  return out;
}

/**
 * Re-encodes an image through a canvas. This is what strips metadata: the
 * canvas only ever sees decoded pixels, so EXIF, GPS, XMP, ICC profiles,
 * camera make and model, timestamps and embedded thumbnails are all dropped
 * before the bytes reach the network or localStorage.
 */
async function readImage(file: File, index: number): Promise<Attachment> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new AttachmentRejected(
      `That image is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_IMAGE_BYTES)}.`,
    );
  }

  const bitmap = await loadBitmap(file);
  if (Math.min(bitmap.width, bitmap.height) < MIN_EDGE) {
    throw new AttachmentRejected(
      `That image is ${bitmap.width}x${bitmap.height}. It needs to be at least ${MIN_EDGE}px on the short edge.`,
    );
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AttachmentRejected("Your browser could not process that image.");

  // Flatten onto white so transparent PNGs stay readable for the model.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  if ("close" in bitmap) bitmap.close();

  const hasAlpha = file.type === "image/png" || file.type === "image/webp";
  const dataUrl = hasAlpha
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", JPEG_QUALITY);

  return {
    kind: "image",
    name: displayName(file, index),
    dataUrl,
    width,
    height,
    bytes: dataUrlBytes(dataUrl),
  };
}

/** HEIC and friends: the browser cannot decode them, so send the original. */
async function readRawImage(file: File, index: number): Promise<Attachment> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new AttachmentRejected(
      `That image is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_IMAGE_BYTES)}.`,
    );
  }
  const dataUrl = await fileToDataUrl(file);
  return {
    kind: "image",
    name: displayName(file, index),
    dataUrl,
    bytes: dataUrlBytes(dataUrl),
  };
}

async function readAudio(file: File): Promise<Attachment> {
  if (file.size > MAX_AUDIO_BYTES) {
    throw new AttachmentRejected(
      `That clip is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_AUDIO_BYTES)}.`,
    );
  }
  const dataUrl = await fileToDataUrl(file);
  return {
    kind: "audio",
    name: stripExtension(file.name) || "Recording",
    dataUrl,
    bytes: dataUrlBytes(dataUrl),
  };
}

/** Picks up files the user pasted, from the clipboard or a drag. */
export function filesFromClipboard(data: DataTransfer): File[] {
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  // Some browsers expose pasted screenshots only through `files`.
  if (files.length === 0) files.push(...Array.from(data.files ?? []));
  return files;
}

/** True when a paste looks like a file rather than text. */
export function clipboardHasFiles(data: DataTransfer): boolean {
  return Array.from(data.items ?? []).some((item) => item.kind === "file");
}

function displayName(file: File, index: number): string {
  const base = stripExtension(file.name);
  if (base && base !== "image" && base !== "blob") return base;
  return `Worksheet ${index + 1}`;
}

function guessType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    avif: "image/avif",
    heic: "image/heic",
    heif: "image/heif",
    pdf: "application/pdf",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    webm: "audio/webm",
    flac: "audio/flac",
  };
  return map[ext] ?? "";
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new AttachmentRejected(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // imageOrientation honours EXIF rotation so sideways photos stay upright.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to the <img> path */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new AttachmentRejected("That image could not be read."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { PdfRejected };
