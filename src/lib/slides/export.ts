import { BRAND } from "../brand";
import { effectiveLayout, type Deck, type Slide } from "./spec";

/**
 * Deck export, all client-side. Three targets, because "make slides" means
 * different things to different people:
 *
 *   1. PDF / print, via the browser's own print dialog. A deck printed as one
 *      landscape page per slide is what a student hands in.
 *   2. A self-contained .html file, which keeps the animations and needs no
 *      software to open.
 *   3. A real .pptx, so it opens in PowerPoint, Keynote and Google Slides and
 *      can be edited there. Written from scratch: the browser has no Office
 *      library, and a deck the student cannot open in Slides is not the
 *      feature they asked for.
 *
 * Nothing is uploaded. Every path here builds bytes in the page and hands them
 * to a download.
 */

/* ------------------------------------------------------------------ palette */

interface Palette {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  panel: string;
}

const PALETTES: Record<string, Palette> = {
  slate: { bg: "#111318", fg: "#f2f4f6", muted: "#9aa2ab", accent: "#2dd4bf", panel: "#1b1e24" },
  paper: { bg: "#f7f8f8", fg: "#14181c", muted: "#5f676f", accent: "#0f9b8e", panel: "#ffffff" },
  contrast: { bg: "#050607", fg: "#ffffff", muted: "#c4cad1", accent: "#f0a35e", panel: "#17191c" },
  dusk: { bg: "#1a1626", fg: "#f4f1ff", muted: "#b3a8d4", accent: "#a78bfa", panel: "#241f38" },
  mint: { bg: "#0b1f1c", fg: "#eafff9", muted: "#8fc9bd", accent: "#5fbf6f", panel: "#12302b" },
};

export function paletteFor(theme: string): Palette {
  return PALETTES[theme] ?? PALETTES.slate;
}

/* --------------------------------------------------------------- filenames */

/** A filesystem-safe stem from a deck title. */
export function deckFilename(deck: Deck, extension: string): string {
  const cleaned = deck.title
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48)
    .toLowerCase();
  return `${cleaned || "presentation"}.${extension}`;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------- html escape */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline emphasis only: `code`, **bold**, *italic*, and links. */
function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

/* ------------------------------------------------------------ deck to HTML */

/** One slide as a static HTML section, shared by the file export and print. */
function slideHtml(slide: Slide, index: number): string {
  return `<section class="slide layout-${effectiveLayout(slide, index)}">
  <div class="inner">${slideInnerHtml(slide, index)}</div>
</section>`;
}

/** The contents of a slide, without the section wrapper. */
function slideInnerHtml(slide: Slide, index: number): string {
  const layout = effectiveLayout(slide, index);
  const body = slide.body.map((line) => `<p>${inlineHtml(line)}</p>`).join("");
  const bullets = slide.bullets.length
    ? `<${slide.ordered ? "ol" : "ul"}>${slide.bullets
        .map((item) => `<li>${inlineHtml(item)}</li>`)
        .join("")}</${slide.ordered ? "ol" : "ul"}>`
    : "";
  const quote = slide.quote ? `<blockquote>${inlineHtml(slide.quote)}</blockquote>` : "";
  const code = slide.code ? `<pre><code>${escapeHtml(slide.code.text)}</code></pre>` : "";
  const image = slide.image ? `<img src="${escapeHtml(slide.image)}" alt="" />` : "";
  const subtitle = slide.subtitle ? `<p class="sub">${inlineHtml(slide.subtitle)}</p>` : "";
  void layout;

  return `${slide.title ? `<h2>${inlineHtml(slide.title)}</h2>` : ""}
    ${subtitle}
    <div class="content">${body}${bullets}${quote}${code}${image}</div>`;
}

/**
 * A whole deck as one self-contained HTML file: styles inlined, one slide per
 * screen, arrow keys and click to move, and a print stylesheet that puts one
 * slide on each landscape page. No scripts beyond the navigation, no network.
 */
export function deckToHtml(deck: Deck): string {
  const palette = paletteFor(deck.theme);
  const slides = deck.slides.map((slide, i) => slideHtml(slide, i)).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(deck.title)}</title>
<style>
  :root {
    --bg: ${palette.bg};
    --fg: ${palette.fg};
    --muted: ${palette.muted};
    --accent: ${palette.accent};
    --panel: ${palette.panel};
    --ease: cubic-bezier(0.16, 1, 0.3, 1);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--fg);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  body { overflow: hidden; }
  .slide { position: fixed; inset: 0; display: none; padding: 7vh 8vw;
    opacity: 0; transition: opacity 0.5s var(--ease); }
  .slide.active { display: flex; opacity: 1; }
  .inner { margin: auto 0; width: 100%; max-width: 64rem;
    animation: rise 0.5s var(--ease) both; }
  @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  h2 { margin: 0 0 0.4em; font-size: clamp(2rem, 4.4vw, 3.6rem); font-weight: 600;
    letter-spacing: -0.02em; line-height: 1.08; }
  .sub { margin: 0 0 1em; color: var(--accent); font-size: clamp(1rem, 1.7vw, 1.4rem);
    font-weight: 500; letter-spacing: 0.01em; }
  .content p { margin: 0 0 0.7em; font-size: clamp(1rem, 1.7vw, 1.35rem);
    line-height: 1.6; color: var(--fg); max-width: 46ch; }
  ul, ol { margin: 0.2em 0 0; padding-left: 1.3em; }
  li { margin: 0.35em 0; font-size: clamp(1rem, 1.7vw, 1.35rem); line-height: 1.55; }
  li::marker { color: var(--accent); }
  blockquote { margin: 0.4em 0; padding-left: 1.1em; border-left: 3px solid var(--accent);
    font-size: clamp(1.2rem, 2.4vw, 2rem); font-style: italic; color: var(--fg); }
  pre { margin: 0.4em 0; padding: 1em 1.2em; border-radius: 12px; background: var(--panel);
    overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: clamp(0.8rem, 1.2vw, 1rem); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  p code, li code { background: var(--panel); padding: 0.1em 0.35em; border-radius: 5px; font-size: 0.9em; }
  a { color: var(--accent); }
  img { max-width: 100%; max-height: 52vh; border-radius: 12px; }
  .layout-title { text-align: center; }
  .layout-title .inner { margin: auto; }
  .layout-section { text-align: left; }
  .layout-section h2 { color: var(--accent); }
  .layout-quote blockquote { font-size: clamp(1.5rem, 3.4vw, 2.8rem); border: 0; padding: 0; }
  .counter { position: fixed; right: 2.2vw; bottom: 3vh; font-size: 0.8rem;
    color: var(--muted); font-variant-numeric: tabular-nums; z-index: 5; }
  .bar { position: fixed; left: 0; top: 0; height: 2px; background: var(--accent);
    transition: width 0.45s var(--ease); z-index: 5; }
  @media print {
    body { overflow: visible; }
    .counter, .bar { display: none; }
    .slide { position: static; display: flex !important; opacity: 1 !important;
      page-break-after: always; height: 100vh; padding: 6vh 7vw; }
    @page { size: landscape; margin: 0; }
  }
</style>
</head>
<body>
<div class="bar" id="bar"></div>
${slides}
<div class="counter" id="counter"></div>
<script>
  var slides = [].slice.call(document.querySelectorAll(".slide"));
  var i = 0;
  function show(n) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach(function (s, k) { s.classList.toggle("active", k === i); });
    document.getElementById("counter").textContent = (i + 1) + " / " + slides.length;
    document.getElementById("bar").style.width = ((i + 1) / slides.length * 100) + "%";
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === " " || e.key === "PageDown") { e.preventDefault(); show(i + 1); }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") { e.preventDefault(); show(i - 1); }
    if (e.key === "Home") show(0);
    if (e.key === "End") show(slides.length - 1);
  });
  document.addEventListener("click", function () { show(i + 1); });
  show(0);
</script>
</body>
</html>`;
}

export function downloadDeckHtml(deck: Deck): void {
  download(new Blob([deckToHtml(deck)], { type: "text/html;charset=utf-8" }), deckFilename(deck, "html"));
}

/* -------------------------------------------------------------------- print */

/**
 * Opens a print window holding the deck, one slide per landscape page. The
 * browser's own dialog handles "Save as PDF", so there is no PDF library in the
 * bundle and the student gets the real print pipeline.
 */
export function printDeck(deck: Deck): void {
  const win = window.open("", "_blank", "noopener,noreferrer,width=1280,height=800");
  if (!win) return;

  const palette = paletteFor(deck.theme);
  const slides = deck.slides
    .map((slide, i) => `<section class="page">\n  <div class="inner">${slideInnerHtml(slide, i)}</div>\n</section>`)
    .join("\n");

  win.document.write(`<!doctype html><html><head><meta charset="utf-8" />
<title>${escapeHtml(deck.title)}</title>
<style>
  @page { size: landscape; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; background: ${palette.bg}; color: ${palette.fg};
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .page { width: 100vw; height: 100vh; padding: 6vh 7vw; display: flex; overflow: hidden;
    page-break-after: always; break-after: page; background: ${palette.bg}; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .inner { margin: auto 0; width: 100%; max-width: 64rem; }
  h2 { margin: 0 0 0.4em; font-size: 2.6rem; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; }
  .sub { margin: 0 0 1em; color: ${palette.accent}; font-size: 1.2rem; font-weight: 500; }
  .content p { margin: 0 0 0.7em; font-size: 1.15rem; line-height: 1.6; max-width: 46ch; }
  ul, ol { margin: 0.2em 0 0; padding-left: 1.3em; }
  li { margin: 0.35em 0; font-size: 1.15rem; line-height: 1.55; }
  li::marker { color: ${palette.accent}; }
  blockquote { margin: 0.4em 0; padding-left: 1.1em; border-left: 3px solid ${palette.accent};
    font-size: 1.8rem; font-style: italic; }
  pre { margin: 0.4em 0; padding: 1em 1.2em; border-radius: 12px; background: ${palette.panel};
    font-family: ui-monospace, Menlo, monospace; font-size: 0.95rem; white-space: pre-wrap; }
  p code, li code { background: ${palette.panel}; padding: 0.1em 0.35em; border-radius: 5px; }
  img { max-width: 100%; max-height: 48vh; border-radius: 12px; }
  .layout-title { text-align: center; }
  .layout-title .inner { margin: auto; }
  .layout-section h2 { color: ${palette.accent}; }
  .layout-quote blockquote { border: 0; padding: 0; font-size: 2.4rem; }
</style></head><body>${slides}
<script>window.addEventListener("load", function () { window.print(); });</script>
</body></html>`);
  win.document.close();
}

/* -------------------------------------------------------------------- pptx */

/**
 * A minimal ZIP writer. Office files are ZIPs, and the browser has no ZIP
 * library, so the archive is built here. Entries are stored uncompressed: the
 * XML is small, and "stored" keeps the writer to a CRC and two headers.
 */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function zip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array([
      ...u32(0x04034b50),
      ...u16(20), // version needed
      ...u16(0), // flags
      ...u16(0), // method: stored
      ...u16(0), // mod time
      ...u16(0), // mod date
      ...u32(crc),
      ...u32(size),
      ...u32(size),
      ...u16(nameBytes.length),
      ...u16(0), // extra length
    ]);
    chunks.push(local, nameBytes, entry.data);

    central.push(
      new Uint8Array([
        ...u32(0x02014b50),
        ...u16(20), // version made by
        ...u16(20), // version needed
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(crc),
        ...u32(size),
        ...u32(size),
        ...u16(nameBytes.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        ...nameBytes,
      ]),
    );

    offset += local.length + nameBytes.length + size;
  }

  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(offset),
    ...u16(0),
  ]);

  // The parts are copied into one buffer: a `Uint8Array` view is not a valid
  // BlobPart under the DOM types unless its buffer is a plain ArrayBuffer.
  const parts = [...chunks, ...central, end];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }

  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

/** Slide size in EMU: 13.333in x 7.5in, the widescreen default. */
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;

function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A `<a:solidFill>` for a hex colour, with the leading `#` removed. */
function solidFill(hex: string): string {
  return `<a:solidFill><a:srgbClr val="${hex.replace("#", "").toUpperCase()}"/></a:solidFill>`;
}

interface TextRun {
  text: string;
  size: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  /** Extra space above, in points. */
  spaceBefore?: number;
  /** Bulleted paragraph. */
  bullet?: boolean;
  indent?: number;
}

/** One text box shape, positioned in EMU. */
function textBox(
  id: number,
  name: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  runs: TextRun[],
): string {
  const paragraphs = runs
    .map((run) => {
      const spaceBefore = run.spaceBefore
        ? `<a:spcBef><a:spcPts val="${Math.round(run.spaceBefore * 100)}"/></a:spcBef>`
        : "";
      const bullet = run.bullet
        ? `<a:buFont typeface="Arial"/><a:buChar char="•"/>`
        : `<a:buNone/>`;
      const pPr = `<a:pPr marL="${run.indent ?? 0}" indent="${run.bullet ? -228600 : 0}">${spaceBefore}${bullet}</a:pPr>`;
      return `<a:p>${pPr}<a:r><a:rPr lang="en-US" sz="${Math.round(run.size * 100)}"${run.bold ? ' b="1"' : ""}${run.italic ? ' i="1"' : ""} dirty="0">${solidFill(run.color)}<a:latin typeface="Calibri Light"/><a:cs typeface="Calibri Light"/></a:rPr><a:t>${xml(run.text)}</a:t></a:r></a:p>`;
    })
    .join("");

  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${Math.round(x)}" y="${Math.round(y)}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr wrap="square" anchor="t"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

/** Builds one slide's XML from a slide and the deck palette. */
function slideXml(slide: Slide, index: number, palette: Palette, deck: Deck): string {
  const layout = effectiveLayout(slide, index);
  const shapes: string[] = [];
  let id = 2;

  // Background as a full-bleed rectangle, so the theme travels with the file.
  shapes.push(
    `<p:sp><p:nvSpPr><p:cNvPr id="1" name="Background"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_W}" cy="${SLIDE_H}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solidFill(palette.bg)}<a:ln><a:noFill/></a:ln></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`,
  );

  const centered = layout === "title";
  const marginX = centered ? 0.1 : 0.08;
  const left = SLIDE_W * marginX;
  const width = SLIDE_W * (1 - marginX * 2);
  let top = SLIDE_H * (centered ? 0.34 : 0.12);

  if (slide.title) {
    const size = layout === "title" ? 40 : layout === "section" ? 36 : 30;
    const color = layout === "section" ? palette.accent : palette.fg;
    shapes.push(
      textBox(id++, "Title", left, top, width, SLIDE_H * 0.2, [
        { text: slide.title, size, color, bold: true },
      ]),
    );
    top += layout === "title" ? SLIDE_H * 0.16 : SLIDE_H * 0.15;
  }

  if (slide.subtitle) {
    shapes.push(
      textBox(id++, "Subtitle", left, top, width, SLIDE_H * 0.1, [
        { text: slide.subtitle, size: 18, color: palette.accent },
      ]),
    );
    top += SLIDE_H * 0.1;
  }

  const bodyRuns: TextRun[] = [];
  for (const line of slide.body) {
    bodyRuns.push({ text: line, size: 17, color: palette.fg, spaceBefore: bodyRuns.length ? 8 : 0 });
  }
  if (slide.quote) {
    bodyRuns.push({ text: `“${slide.quote}”`, size: 22, color: palette.fg, italic: true, spaceBefore: 6 });
  }
  for (const item of slide.bullets) {
    bodyRuns.push({
      text: item,
      size: 17,
      color: palette.fg,
      bullet: true,
      indent: 285750,
      spaceBefore: 6,
    });
  }
  if (slide.code) {
    bodyRuns.push({ text: slide.code.text, size: 13, color: palette.muted, spaceBefore: 8 });
  }

  if (bodyRuns.length) {
    shapes.push(textBox(id++, "Body", left, top, width, SLIDE_H - top - SLIDE_H * 0.1, bodyRuns));
  }

  if (deck.footer) {
    shapes.push(
      textBox(id++, "Footer", left, SLIDE_H - SLIDE_H * 0.08, width, SLIDE_H * 0.06, [
        { text: deck.footer, size: 11, color: palette.muted },
      ]),
    );
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${shapes.join("\n")}
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Folio">
<a:themeElements>
<a:clrScheme name="Folio">
<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F2226"/></a:dk2>
<a:lt2><a:srgbClr val="F2F4F6"/></a:lt2>
<a:accent1><a:srgbClr val="2DD4BF"/></a:accent1>
<a:accent2><a:srgbClr val="6AA6F5"/></a:accent2>
<a:accent3><a:srgbClr val="A78BFA"/></a:accent3>
<a:accent4><a:srgbClr val="F0A35E"/></a:accent4>
<a:accent5><a:srgbClr val="5FBF6F"/></a:accent5>
<a:accent6><a:srgbClr val="F7768E"/></a:accent6>
<a:hlink><a:srgbClr val="2DD4BF"/></a:hlink>
<a:folHlink><a:srgbClr val="A78BFA"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Folio">
<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Folio">
<a:fillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:fillStyleLst>
<a:lnStyleLst>
<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
<a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
<a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
</a:lnStyleLst>
<a:effectStyleLst>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
</a:effectStyleLst>
<a:bgFillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
</a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
<a:objectDefaults/><a:extraClrSchemeLst/>
</a:theme>`;

const MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`;

const LAYOUT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
<p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

/**
 * Builds a .pptx from a deck. Text is written as real text boxes, so the file
 * opens editable in PowerPoint, Keynote and Google Slides rather than as a pile
 * of pictures.
 */
export function deckToPptx(deck: Deck): Blob {
  const palette = paletteFor(deck.theme);
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = [];

  const add = (name: string, text: string) => entries.push({ name, data: encoder.encode(text) });

  const slideCount = deck.slides.length;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${Array.from({ length: slideCount }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("\n")}
</Types>`;

  add("[Content_Types].xml", contentTypes);
  add(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
  );

  add(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${Array.from({ length: slideCount }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst>
<p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}"/><p:notesSz cx="${SLIDE_H}" cy="${SLIDE_W}"/>
</p:presentation>`,
  );

  add(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${Array.from({ length: slideCount }, (_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("\n")}
</Relationships>`,
  );

  add("ppt/slideMasters/slideMaster1.xml", MASTER_XML);
  add(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`,
  );

  add("ppt/slideLayouts/slideLayout1.xml", LAYOUT_XML);
  add(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`,
  );

  add("ppt/theme/theme1.xml", THEME_XML);

  deck.slides.forEach((slide, i) => {
    add(`ppt/slides/slide${i + 1}.xml`, slideXml(slide, i, palette, deck));
    add(
      `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`,
    );
  });

  return zip(entries);
}

export function downloadDeckPptx(deck: Deck): void {
  download(deckToPptx(deck), deckFilename(deck, "pptx"));
}

/** Credit line for the exported HTML footer, kept out of the deck itself. */
export const DECK_CREDIT = `Made with ${BRAND.name}`;

/** Kept for parity with the other exporters and used in tests. */
export { inlineHtml as __inlineHtml };
