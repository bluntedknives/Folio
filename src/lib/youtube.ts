/**
 * YouTube link handling, shared by the client and the server.
 *
 * A video is identified in the conversation by its id alone. The client never
 * stores the video's metadata: it sends the id, and the server re-reads the
 * video when a turn needs it. That keeps the stored conversation small and
 * means a video's title or description is never stale.
 */

const ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Hosts that carry a YouTube video id in their path. Shorts, live and embed
 * links all point at the same video, so they resolve to the same id and a
 * follow-up question still finds the video.
 */
const HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

/** Pulls the id out of any YouTube URL shape. Returns null when there is none. */
export function videoIdFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();

  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && ID.test(id) ? id : null;
  }

  if (!HOSTS.has(host)) return null;

  // /watch?v=ID is the common case; /shorts/ID, /embed/ID and /live/ID put it
  // in the path instead.
  const query = url.searchParams.get("v");
  if (query && ID.test(query)) return query;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2) {
    const [kind, id] = segments;
    if ((kind === "shorts" || kind === "embed" || kind === "live" || kind === "v") && ID.test(id)) {
      return id;
    }
  }
  return null;
}

/**
 * Finds the first YouTube link in a block of text. The client uses this to
 * show a preview chip and to decide whether a turn is about a video.
 */
export function findVideoUrl(text: string): { url: string; id: string } | null {
  // Trailing punctuation is common in prose ("...this video: <url>."), so the
  // match is trimmed of anything that cannot be part of a URL.
  const matches = text.match(/https?:\/\/[^\s<>"')]+/g);
  if (!matches) return null;
  for (const candidate of matches) {
    const url = candidate.replace(/[.,;:!?)\]]+$/, "");
    const id = videoIdFromUrl(url);
    if (id) return { url, id };
  }
  return null;
}

/**
 * The video id the newest user turn refers to, or null. Walks back over the
 * turns so a follow-up ("what did they say about that?") still resolves to the
 * video that was linked earlier in the conversation.
 */
export function latestVideoId(messages: { role: string; content: string }[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const found = findVideoUrl(messages[i].content);
    if (found) return found.id;
  }
  return null;
}
