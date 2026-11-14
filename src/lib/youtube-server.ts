import type { VideoContext } from "./types";

/**
 * Reads what can be read about a YouTube video, on the server.
 *
 * There is no API key and no third-party service. Three things are fetched
 * directly from YouTube, all of which answer a plain request:
 *
 *   1. oEmbed — the title and channel, in JSON, with no bot check.
 *   2. The watch page's `ytInitialData` — the description, duration and publish
 *      date, embedded in the HTML.
 *   3. Four still frames — `maxresdefault` plus `hq1..hq3`, which are four
 *      different moments in the video, not four sizes of one image.
 *
 * What is deliberately absent is the transcript. Every caption route
 * (timedtext, the InnerTube `get_transcript` endpoint, the player response's
 * `captionTracks`) is refused for a datacenter IP: the player answers
 * LOGIN_REQUIRED or UNPLAYABLE and timedtext returns an empty body. Public
 * mirrors that proxy captions (Piped, Invidious, reader services) are likewise
 * blocked or require a token. So the honest description is metadata plus
 * frames, and the answer is required to say that it did not hear the audio.
 * When a caption track is reachable — from a residential IP, say — the model
 * would still be told it has no transcript, which is the safe direction to err.
 */

const WATCH = "https://www.youtube.com/watch?v=";
const OEMBED = "https://www.youtube.com/oembed?format=json&url=";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 60;
const cache = new Map<string, { at: number; value: VideoContext | null }>();

/**
 * Loads a video, or null when YouTube gave us nothing usable. Never throws:
 * a video that cannot be read must not fail the student's question.
 */
export async function loadVideo(videoId: string): Promise<VideoContext | null> {
  const hit = cache.get(videoId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const [meta, page, frames] = await Promise.all([
    oembed(videoId).catch(() => null),
    watchPage(videoId).catch(() => null),
    framesFor(videoId).catch(() => []),
  ]);

  const title = meta?.title ?? page?.title ?? "";
  // Without at least a title there is nothing worth putting in the prompt.
  if (!title) {
    remember(videoId, null);
    return null;
  }

  const value: VideoContext = {
    id: videoId,
    url: `${WATCH}${videoId}`,
    title,
    channel: meta?.channel ?? page?.channel ?? "",
    duration: page?.duration ?? "",
    published: page?.published ?? "",
    description: (page?.description ?? "").replace(/\s+/g, " ").trim().slice(0, 1600),
    frames,
  };

  remember(videoId, value);
  return value;
}

function remember(videoId: string, value: VideoContext | null): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(videoId, { at: Date.now(), value });
}

/** Title and channel, from the endpoint that has no bot check. */
async function oembed(videoId: string): Promise<{ title: string; channel: string } | null> {
  const response = await fetch(`${OEMBED}${encodeURIComponent(`${WATCH}${videoId}`)}`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { title?: unknown; author_name?: unknown };
  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (!title) return null;
  return {
    title,
    channel: typeof data.author_name === "string" ? data.author_name.trim() : "",
  };
}

interface PageMeta {
  title: string;
  channel: string;
  duration: string;
  published: string;
  description: string;
}

/**
 * The description, duration and publish date from the watch page. The page
 * carries a large `ytInitialData` blob; it is extracted by matching braces
 * rather than with a regex, because the value contains nested objects.
 */
async function watchPage(videoId: string): Promise<PageMeta | null> {
  const response = await fetch(`${WATCH}${videoId}&hl=en`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;

  const html = await response.text();
  const marker = html.indexOf("ytInitialData");
  if (marker === -1) return null;

  const start = html.indexOf("{", marker);
  const raw = start === -1 ? null : balanced(html, start);
  if (!raw) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  return {
    title: firstText(data, "title"),
    channel: firstText(data, "ownerChannelName") || firstText(data, "author"),
    duration: firstText(data, "lengthText"),
    published: firstText(data, "publishDate") || firstText(data, "relativeDateText"),
    description: firstText(data, "attributedDescription"),
  };
}

/**
 * The four stills. `maxresdefault` is the sharpest and often a title card;
 * `hq1..hq3` are three other moments. Each is passed through the vision model
 * as-is, so the bytes are fetched and inlined here rather than linked.
 */
async function framesFor(videoId: string): Promise<string[]> {
  const candidates = ["maxresdefault", "hq1", "hq2", "hq3"];
  const results = await Promise.all(
    candidates.map((name) => fetchFrame(`https://i.ytimg.com/vi/${videoId}/${name}.jpg`)),
  );
  return results.filter((frame): frame is string => frame !== null);
}

async function fetchFrame(url: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return null;

  const bytes = Buffer.from(await response.arrayBuffer());
  // A missing frame comes back as a tiny grey placeholder; ignore those.
  if (bytes.length < 2048) return null;

  const mime = type.split(";")[0].trim();
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

/**
 * Returns the JSON object starting at `start`, matching braces and ignoring
 * any that appear inside strings. `JSON.parse` on a greedy regex fails here,
 * because the blob contains nested objects and escaped quotes.
 */
function balanced(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Depth-first search for the first value under `key` that reads as text.
 * ytInitialData is deeply nested and the path to a field differs between
 * videos, so the key is looked up rather than a path being hardcoded.
 */
function firstText(node: unknown, key: string, depth = 0): string {
  if (depth > 24 || node === null || typeof node !== "object") return "";

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = firstText(child, key, depth + 1);
      if (found) return found;
    }
    return "";
  }

  const record = node as Record<string, unknown>;
  if (key in record) {
    const text = textOf(record[key]);
    if (text) return text;
  }
  for (const value of Object.values(record)) {
    const found = firstText(value, key, depth + 1);
    if (found) return found;
  }
  return "";
}

/** Reads the several shapes YouTube uses for a run of text. */
function textOf(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value === null || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.content === "string") return record.content.trim();
  if (typeof record.simpleText === "string") return record.simpleText.trim();
  if (Array.isArray(record.runs)) {
    return record.runs
      .map((run) => textOf(run))
      .join("")
      .trim();
  }
  return "";
}

/**
 * Renders the video block that is appended to the system prompt. It states
 * plainly what is and is not available, because the failure mode here is the
 * model inventing spoken content it never heard.
 */
export function formatVideo(video: VideoContext): string {
  const facts = [
    `Title: ${video.title}`,
    video.channel ? `Channel: ${video.channel}` : "",
    video.duration ? `Duration: ${video.duration}` : "",
    video.published ? `Published: ${video.published}` : "",
    `URL: ${video.url}`,
    video.description ? `Description: ${video.description}` : "",
  ].filter(Boolean);

  const frames =
    video.frames.length > 0
      ? `${video.frames.length} still frame${video.frames.length > 1 ? "s" : ""} from the video are attached as images. They are a handful of moments, not the whole video.`
      : "No still frames could be loaded.";

  return [
    "YouTube video for this question.",
    facts.join("\n"),
    `${frames} You do not have the audio and you do not have a transcript, so you cannot describe what is said or summarise the spoken content. Say so rather than guessing.`,
  ].join("\n\n");
}

/**
 * Renders the block used when the student linked a video but YouTube returned
 * nothing readable. Without this the model receives no hint that a video was
 * involved, and answers with a long speculative monologue about being unable
 * to browse. Telling it plainly that the link could not be read keeps the reply
 * to one honest line.
 */
export function formatUnreadableVideo(videoId: string): string {
  return [
    "YouTube video for this question.",
    `URL: ${WATCH}${videoId}`,
    "The video's details could not be read, and no frames were loaded. You do not know its title, channel or content.",
    "Say in one short line that you could not read this video, and offer to help if the student describes it or pastes the relevant text. Do not speculate about why, and do not narrate any policy.",
  ].join("\n\n");
}
