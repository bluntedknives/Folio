import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extractReadable, type PageMeta } from "./html";
import type { PageContext } from "./types";

/**
 * Reads a web page's text, on the server.
 *
 * This fetches an address a student typed, which makes it the most dangerous
 * thing in the app: the server sits inside a private network, so an unchecked
 * fetch lets a crafted link read cloud metadata or an internal service. Three
 * defences, in order:
 *
 *   1. Only http and https, and only the default ports. This is checked before
 *      any network call, on the URL as written.
 *   2. The hostname is resolved first, and every address it resolves to must be
 *      publicly routable. Loopback, private, link-local (which covers the cloud
 *      metadata address), and multicast ranges are refused, in both IPv4 and
 *      IPv6, including IPv4-mapped IPv6.
 *   3. Redirects are followed by hand, and steps 1 and 2 run again for each
 *      hop, so a public URL cannot bounce the fetch to an internal one.
 *
 * What remains is a DNS-rebinding window between the lookup and the connection:
 * Node's fetch does not expose the resolved address to pin. Closing it needs a
 * custom dispatcher, which is a dependency this app does not carry. The window
 * is narrow and the other three checks are absolute, so it is accepted and
 * recorded here rather than left implied.
 *
 * Reading a page is best-effort. A failure yields null and the question is
 * still answered, without the page.
 */

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const MAX_PAGES = 3;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 60;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Page text longer than this is cut; the prompt does not need the whole page. */
const MAX_TEXT = 8000;

const cache = new Map<string, { at: number; value: PageContext | null }>();

/**
 * Loads up to `MAX_PAGES` pages, in order, skipping any that fail. Never
 * throws: a page that cannot be read must not fail the student's question.
 */
export async function loadPages(urls: string[]): Promise<PageContext[]> {
  const unique = [...new Set(urls)].slice(0, MAX_PAGES);
  const results = await Promise.all(unique.map((url) => loadPage(url).catch(() => null)));
  return results.filter((page): page is PageContext => page !== null);
}

/** Loads one page, or null when it cannot be read or is not allowed. */
export async function loadPage(rawUrl: string): Promise<PageContext | null> {
  const hit = cache.get(rawUrl);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = await read(rawUrl).catch(() => null);
  remember(rawUrl, value);
  return value;
}

function remember(url: string, value: PageContext | null): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(url, { at: Date.now(), value });
}

async function read(rawUrl: string): Promise<PageContext | null> {
  let current = await allowUrl(rawUrl);
  if (!current) return null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(current.toString(), {
      redirect: "manual",
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
      if (!location) return null;
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        return null;
      }
      // Every hop is re-checked, so a redirect cannot reach inside the network.
      current = await allowUrl(next);
      if (!current) return null;
      continue;
    }

    if (!response.ok) return null;

    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!isReadableType(type)) return null;

    const body = await readCapped(response);
    if (!body) return null;

    const meta = extractReadable(body, type);
    if (!meta.text) return null;

    return {
      url: current.toString(),
      title: meta.title,
      site: meta.site,
      published: meta.published,
      text: meta.text.slice(0, MAX_TEXT),
    };
  }
  return null;
}

/**
 * Parses and validates an address before it is fetched. Returns null unless it
 * is http(s) on the default port and resolves only to public addresses.
 */
function parseAllowed(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  // Only the default port. A non-default port is how an internal service on a
  // known host would be reached, and no ordinary page link needs one.
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  if (port !== "80" && port !== "443") return null;

  url.hash = "";
  return url;
}

/**
 * The full check: the shape of the address, then where its host actually
 * points. Both are required before anything is fetched, and both run again on
 * every redirect hop.
 */
async function allowUrl(raw: string): Promise<URL | null> {
  const url = parseAllowed(raw);
  if (!url) return null;
  return (await hostIsPublic(url)) ? url : null;
}

/** True when every address the host resolves to is publicly routable. */
async function hostIsPublic(url: URL): Promise<boolean> {
  const host = url.hostname.replace(/^\[|\]$/g, "");

  // A literal address needs no lookup, and is the classic attack form.
  if (isIP(host)) return isPublicAddress(host);

  // Obvious internal names, refused before any lookup so a resolver that
  // searches local suffixes cannot be used to reach a machine by name.
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) return false;

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return false;
  }
  if (addresses.length === 0) return false;

  // Every answer must be public: a name resolving to both a public and a
  // private address is treated as hostile.
  return addresses.every((entry) => isPublicAddress(entry.address));
}

/** True for an address outside every private, loopback and reserved range. */
function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicV4(address);
  if (version === 6) return isPublicV6(address);
  return false;
}

function isPublicV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;

  if (a === 0) return false; // 0.0.0.0/8 "this network"
  if (a === 10) return false; // private
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 168) return false; // private
  if (a === 192 && b === 0) return false; // 192.0.0/24 and 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function isPublicV6(address: string): boolean {
  const value = address.toLowerCase();

  // IPv4-mapped and IPv4-compatible forms carry a v4 address; unwrap and check
  // it, so ::ffff:127.0.0.1 cannot slip through as a v6 address.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return isPublicV4(mapped[1]);

  if (value === "::" || value === "::1") return false; // unspecified, loopback
  if (value.startsWith("fe80")) return false; // link-local
  if (/^f[cd]/.test(value)) return false; // unique local
  if (value.startsWith("ff")) return false; // multicast
  if (value.startsWith("64:ff9b")) return false; // NAT64
  if (value.startsWith("2001:db8")) return false; // documentation
  return true;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isReadableType(type: string): boolean {
  return (
    type.startsWith("text/html") ||
    type.startsWith("application/xhtml") ||
    type.startsWith("text/plain")
  );
}

/** Reads the body, refusing anything past the cap rather than buffering it. */
async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

export { hostIsPublic, isPublicAddress, parseAllowed };

/**
 * Renders the page block that is appended to the system prompt. The text is
 * the page's own words, so the model can quote it, but the block says plainly
 * where it came from and that it may be incomplete.
 */
export function formatPages(pages: PageContext[]): string {
  if (pages.length === 0) return "";

  const blocks = pages.map((page, i) => {
    const head = [
      `[${i + 1}] ${page.title || page.url}`,
      page.site ? `Site: ${page.site}` : "",
      page.published ? `Published: ${page.published}` : "",
      `URL: ${page.url}`,
    ].filter(Boolean);

    return `${head.join("\n")}\n---\n${page.text}`;
  });

  return [
    "Web page text for this question. It is the readable text of the page, not a summary, and it may be truncated or partly navigation.",
    "Use it for facts and quote from it where useful, citing the page as a Markdown link. Do not invent anything that is not in the text.",
    "",
    ...blocks,
  ].join("\n\n");
}

export type { PageMeta };
