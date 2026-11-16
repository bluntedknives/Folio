/**
 * Turns a fetched page into readable text.
 *
 * There is no parser dependency, so this is a deliberately careful strip: drop
 * the elements that never hold the article (script, style, nav, footer, forms),
 * prefer the article body when the page marks one, and collapse what remains
 * into paragraphs. It is not a full readability algorithm and does not claim to
 * be one; it is good enough to answer a question from, and the prompt tells the
 * model the text may be partial.
 */

export interface PageMeta {
  title: string;
  site: string;
  published: string;
  text: string;
}

/** Elements whose contents are never article text. */
const DROP = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  "select",
  "option",
  "iframe",
  "video",
  "audio",
  "figure",
  "dialog",
];

/**
 * Containers that usually hold the article, best first. When one is found, only
 * it is read, which is what keeps a site's menus out of the answer.
 */
const MAIN = [
  "<article",
  "<main",
  'role="main"',
  'itemprop="articleBody"',
  'class="[^"]*post-content',
  'class="[^"]*article-body',
  'class="[^"]*entry-content',
];

export function extractReadable(html: string, contentType: string): PageMeta {
  // A plain-text response is already the text.
  if (contentType.startsWith("text/plain")) {
    return { title: "", site: "", published: "", text: normalise(html) };
  }

  const title =
    metaContent(html, "og:title") ||
    metaContent(html, "twitter:title") ||
    titleTag(html) ||
    "";

  const site =
    metaContent(html, "og:site_name") ||
    metaContent(html, "application-name") ||
    "";

  const published =
    metaContent(html, "article:published_time") ||
    metaContent(html, "datePublished") ||
    metaContent(html, "date") ||
    "";

  const body = pickBody(html);
  const text = normalise(stripElements(body.html), body.found);

  return { title: clean(title), site: clean(site), published: humanDate(published), text };
}

/**
 * The article container when the page marks one, otherwise the whole page.
 * `found` matters to the caller: when the page named its article, the text is
 * already free of menus, so short lines (list items) are kept. Without one the
 * whole page is being read and short lines are mostly navigation, so they go.
 */
function pickBody(html: string): { html: string; found: boolean } {
  const lower = html.toLowerCase();
  for (const marker of MAIN) {
    const at = lower.indexOf(marker.toLowerCase());
    if (at === -1) continue;

    // The opening tag may carry attributes, so start the slice at the tag.
    const open = html.lastIndexOf("<", at);
    const close = matchingClose(html, lower, open);
    if (close > open) return { html: html.slice(open, close), found: true };
  }
  return { html, found: false };
}

/**
 * Finds the end of the element that opens at `start`, counting nested tags of
 * the same name. Returns -1 when it is not closed, so the caller falls back.
 */
function matchingClose(html: string, lower: string, start: number): number {
  const open = /^<([a-z0-9]+)/i.exec(html.slice(start, start + 40));
  if (!open) return -1;
  const tag = open[1].toLowerCase();

  const openTag = new RegExp(`<${tag}\\b`, "g");
  const closeTag = new RegExp(`</${tag}\\s*>`, "g");
  openTag.lastIndex = start;
  closeTag.lastIndex = start;

  let depth = 0;
  let cursor = start;
  while (cursor < lower.length) {
    openTag.lastIndex = cursor;
    closeTag.lastIndex = cursor;
    const nextOpen = openTag.exec(lower);
    const nextClose = closeTag.exec(lower);

    if (!nextClose) return -1;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + nextOpen[0].length;
      continue;
    }
    depth--;
    cursor = nextClose.index + nextClose[0].length;
    if (depth <= 0) return cursor;
  }
  return -1;
}

/** Removes whole elements, including their contents, then all remaining tags. */
function stripElements(html: string): string {
  let out = html;
  for (const tag of DROP) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, "gi");
    const selfClosing = new RegExp(`<${tag}\\b[^>]*/?>`, "gi");
    out = out.replace(paired, " ").replace(selfClosing, " ");
  }

  // Block-level boundaries become paragraph breaks before the tags are removed,
  // so words from adjacent elements do not run together.
  out = out.replace(/<\s*(\/?(?:br|p|div|li|h[1-6]|tr|section|article))\b[^>]*>/gi, "\n");
  return out.replace(/<[^>]*>/g, " ");
}

/**
 * Collapses whitespace into paragraphs. `insideArticle` relaxes the short-line
 * filter: a page that marked its article has no menus to drop, so list items
 * are kept, while a whole page needs the filter to stay readable.
 */
function normalise(text: string, insideArticle = false): string {
  const decoded = decodeEntities(text).replace(/\r/g, "");
  const lines = decoded
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((line) => line.length > 0);

  const out: string[] = [];
  for (const line of lines) {
    // A one- or two-word line is almost always a menu item or a label, but
    // inside an article it can be a list item worth keeping.
    if (!insideArticle && line.length < 25 && !/[.!?]$/.test(line)) continue;
    if (out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out.join("\n\n").trim();
}

function titleTag(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? match[1] : "";
}

/** Reads `<meta property="og:title" content="...">` in either attribute order. */
function metaContent(html: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match && match[1].trim()) return match[1];
  }
  return "";
}

/** An ISO date is shown as a plain one; anything else is passed through. */
function humanDate(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 40);
  return parsed.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function clean(text: string): string {
  return decodeEntities(text).replace(/\s+/g, " ").trim().slice(0, 300);
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "\u2013",
    mdash: "\u2014",
    hellip: "\u2026",
    rsquo: "\u2019",
    lsquo: "\u2018",
    ldquo: "\u201c",
    rdquo: "\u201d",
    times: "\u00d7",
    divide: "\u00f7",
    deg: "\u00b0",
    plusmn: "\u00b1",
    frac12: "\u00bd",
    frac14: "\u00bc",
    sup2: "\u00b2",
    sup3: "\u00b3",
  };

  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => named[name.toLowerCase()] ?? whole);
}

function codePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}
