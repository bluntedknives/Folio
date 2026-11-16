/**
 * Web link handling, shared by the client and the server.
 *
 * A page is identified in the conversation by its address alone, exactly as a
 * YouTube video is identified by its id. The client sends the URL, the server
 * re-fetches the page when a turn needs it, and nothing about the page is ever
 * stored with the chat: a stored copy could only go stale.
 *
 * Links that the video reader handles are deliberately excluded here. YouTube
 * is read a different way (metadata and stills, never the article text), and a
 * watch page would otherwise arrive as a wall of unrelated navigation.
 */

/** Trailing punctuation is common in prose ("see <url>."), so it is trimmed. */
const TRAILING = /[.,;:!?)\]]+$/;

const VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

/** The most pages read from a single turn, so one message cannot fan out. */
export const MAX_PAGES = 3;

export interface WebLink {
  url: string;
  /** Host without the `www.`, for display. */
  host: string;
}

/** True for a host the YouTube reader owns. */
export function isVideoHost(host: string): boolean {
  return VIDEO_HOSTS.has(host.toLowerCase());
}

/**
 * Normalises one candidate address, or returns null when it is not something
 * worth fetching. Anything that is not plain http(s) is dropped, which also
 * rules out `javascript:` and `data:` addresses.
 */
export function webLinkFromUrl(raw: string): WebLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;
  if (isVideoHost(url.hostname)) return null;

  // Credentials in the address are never legitimate here, and forwarding them
  // to the fetch would leak them into a request we do not control.
  if (url.username || url.password) return null;

  url.hash = "";
  return { url: url.toString(), host: displayHost(url.hostname) };
}

/** Every distinct web link in a block of text, capped and in order. */
export function findWebLinks(text: string, max = MAX_PAGES): WebLink[] {
  const matches = text.match(/https?:\/\/[^\s<>"')]+/g);
  if (!matches) return [];

  const out: WebLink[] = [];
  const seen = new Set<string>();
  for (const candidate of matches) {
    const link = webLinkFromUrl(candidate.replace(TRAILING, ""));
    if (!link || seen.has(link.url)) continue;
    seen.add(link.url);
    out.push(link);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The pages the newest user turn refers to. Walks back over the turns so a
 * follow-up ("summarise the second one") still resolves to the links that were
 * given earlier in the conversation.
 */
export function latestWebLinks(
  messages: { role: string; content: string }[],
  max = MAX_PAGES,
): WebLink[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const found = findWebLinks(messages[i].content, max);
    if (found.length) return found;
  }
  return [];
}

/** Host without the `www.`, lowercased, for display and comparison. */
export function displayHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}
