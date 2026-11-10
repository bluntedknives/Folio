import type { Attachment } from "./types";

/**
 * PDF handling runs entirely in the browser. pdf.js renders each page to a
 * canvas, which becomes an image the vision model can read, and the text layer
 * is extracted alongside so the model gets the literal characters too. Nothing
 * is uploaded anywhere; the file never leaves the page.
 *
 * pdf.js is imported dynamically so its (large) bundle only loads when someone
 * actually attaches a PDF.
 */

const MAX_PAGES = 8;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export class PdfRejected extends Error {}

/** Points pdf.js at its own worker and returns the module. */
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
}

interface RenderedPage {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Reads a PDF into one attachment per page. Pages arrive as JPEGs, plus the
 * concatenated text layer on the first attachment so the model has both.
 */
export async function readPdf(file: File): Promise<Attachment[]> {
  const pdfjs = await loadPdfjs();

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false } as never).promise;

  const pageCount = Math.min(doc.numPages, MAX_PAGES);
  const pages: RenderedPage[] = [];
  const texts: string[] = [];

  for (let number = 1; number <= pageCount; number++) {
    const page = await doc.getPage(number);

    const text = await page
      .getTextContent()
      .then((content) =>
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .catch(() => "");
    if (text) texts.push(`Page ${number}: ${text}`);

    const rendered = await renderPage(page as unknown as PdfPage);
    if (rendered) pages.push(rendered);
  }

  await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.();

  if (pages.length === 0) {
    throw new PdfRejected("That PDF has no pages that could be read.");
  }

  const extracted = texts.join("\n\n").slice(0, 20000);
  const baseName = stripExtension(file.name);

  return pages.map((page, index) => ({
    kind: "document" as const,
    name: pages.length > 1 ? `${baseName} · page ${index + 1}` : baseName,
    dataUrl: page.dataUrl,
    width: page.width,
    height: page.height,
    bytes: dataUrlBytes(page.dataUrl),
    pages: pages.length,
    // Attached once, on the first page, so it is not repeated per page.
    text: index === 0 && extracted ? extracted : undefined,
  }));
}

/** Draws one page to a canvas and returns it as a JPEG data URL. */
async function renderPage(page: PdfPage): Promise<RenderedPage | null> {
  const unscaled = page.getViewport({ scale: 1 });
  const scale = Math.min(3, MAX_EDGE / Math.max(unscaled.width, unscaled.height));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // A PDF page has no alpha; fill white so nothing renders on transparency.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  try {
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  } catch {
    return null;
  }

  return {
    dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
    width: canvas.width,
    height: canvas.height,
  };
}

interface PdfPage {
  getViewport: (opts: { scale: number }) => { width: number; height: number };
  render: (opts: {
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
    canvas: HTMLCanvasElement;
  }) => { promise: Promise<void> };
  getTextContent: () => Promise<{ items: unknown[] }>;
}

export function stripExtension(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "").trim() || "document";
}

export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const body = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  return Math.round((body.length * 3) / 4);
}
