import type { Attachment } from "./types";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_EDGE = 1600;
const MIN_EDGE = 128;
const JPEG_QUALITY = 0.86;

export class ImageRejected extends Error {}

const ACCEPTED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

/**
 * Re-encodes an image through a canvas. This is what strips metadata:
 * the canvas only ever sees decoded pixels, so EXIF, GPS, XMP, ICC
 * profiles, camera make/model, timestamps and embedded thumbnails are
 * all dropped before the bytes reach the network or localStorage.
 * The original file object is never read again after decoding.
 */
export async function scrubImage(file: File, index: number): Promise<Attachment> {
  if (!ACCEPTED.has(file.type)) {
    throw new ImageRejected(
      `Unsupported file type. Use PNG, JPEG, WebP, GIF or BMP.`,
    );
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageRejected(
      `That image is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_IMAGE_BYTES)}.`,
    );
  }

  const bitmap = await loadBitmap(file);
  if (Math.min(bitmap.width, bitmap.height) < MIN_EDGE) {
    throw new ImageRejected(
      `That image is ${bitmap.width}x${bitmap.height}. It needs to be at least ${MIN_EDGE}px on the short edge for the model to read it.`,
    );
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageRejected("Your browser could not process that image.");

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
    dataUrl,
    label: `Worksheet ${index + 1}`,
    width,
    height,
    bytes: dataUrlBytes(dataUrl),
  };
}

export async function scrubImages(files: File[]): Promise<Attachment[]> {
  const accepted = files.slice(0, MAX_IMAGES_PER_MESSAGE);
  return Promise.all(accepted.map((file, i) => scrubImage(file, i)));
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
      img.onerror = () => reject(new ImageRejected("That image could not be read."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const body = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  return Math.round((body.length * 3) / 4);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
