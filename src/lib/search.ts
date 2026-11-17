import type { Source } from "./types";
import { capPerDomain, withDomain } from "./domain";

/**
 * Web search, run on the server so there is no CORS problem, the query never
 * touches the client, and repeats can be cached.
 *
 * Two sources are combined:
 *
 *   1. DuckDuckGo's no-JavaScript HTML endpoint. This is what gives current
 *      results, but it is an undocumented endpoint behind bot detection: from a
 *      datacenter IP it often answers with a challenge page instead of results.
 *      We use GET rather than POST, which is challenged far less often.
 *   2. Wikipedia's search API. Always available and never challenged, so it
 *      still gives the model real, citable context when DuckDuckGo refuses.
 *
 * Both are best-effort. A failure yields fewer results, never an error, so a
 * question is always answered even when search is unavailable.
 *
 * Every result's `host` and `site` are derived from the result URL itself, in
 * `domain.ts`. The search engine's own display string is only used as a
 * cross-check: when the two disagree the URL wins, because the display string
 * is what a student reads and a label that disagrees with its link is worse
 * than no label.
 */

const DDG_ENDPOINT = "https://html.duckduckgo.com/html/";
const WIKI_ENDPOINT = "https://en.wikipedia.org/w/api.php";

const DDG_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/** Wikipedia asks for a descriptive agent with contact info. */
const WIKI_UA = "Folio/0.1 (homework helper; +https://github.com/bluntedknives/Folio)";

const MAX_RESULTS = 8;
/** At most this many results from one registrable domain, so no site dominates. */
const PER_DOMAIN = 2;
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 100;

const cache = new Map<string, { at: number; results: Source[] }>();

/**
 * Looks up a query across both sources. Never throws: a failure yields an
 * empty or partial list so the caller can carry on without web context.
 */
export async function search(query: string): Promise<Source[]> {
  const trimmed = query.trim().slice(0, 400);
  if (!trimmed) return [];

  const key = trimmed.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.results;

  // DuckDuckGo first, since it reflects the live web; Wikipedia fills the gap.
  const [ddg, wiki] = await Promise.all([
    duckDuckGo(trimmed).catch(() => []),
    wikipedia(trimmed).catch(() => []),
  ]);

  const merged = dedupe([...ddg, ...wiki]);
  // Cap per domain so one site cannot fill the list, but fall back to the
  // uncapped list when that leaves too little to be useful (e.g. a query whose
  // every hit is on one big site).
  const capped = capPerDomain(merged, PER_DOMAIN);
  const results = (capped.length >= 4 ? capped : merged).slice(0, MAX_RESULTS);

  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, { at: Date.now(), results });
  return results;
}

/** True when the prompt looks like it wants facts from the open web. */
export function shouldSearch(prompt: string): boolean {
  const text = prompt.trim();
  if (text.length < 3) return false;

  // "What is 2+2", "solve for x", "integrate x^2" are self-contained.
  if (/^(solve|simplify|factor|expand|differentiate|integrate|evaluate|compute|calculate|prove)\b/i.test(text)) {
    return false;
  }
  if (/^[\d\s+\-*/^().=]+$/.test(text)) return false;

  return SEARCH_CUES.test(text);
}

const SEARCH_CUES =
  /\b(who|whom|whose|when|where|which|what)\b|\b(latest|current|currently|today|tonight|yesterday|this (year|week|month)|news|recent|recently|up[- ]to[- ]date|20\d\d)\b|\b(history of|biography|born|died|population|capital of|president|prime minister|war of|treaty|discovered|invented|definition of|meaning of|difference between|compare|vs\.?)\b/i;

/** DuckDuckGo's HTML results, unwrapped from their redirect links. */
async function duckDuckGo(query: string): Promise<Source[]> {
  const response = await fetch(`${DDG_ENDPOINT}?q=${encodeURIComponent(query)}`, {
    headers: {
      "User-Agent": DDG_UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return [];

  const html = await response.text();
  // A 202 or a page carrying this marker is DuckDuckGo's bot challenge.
  if (html.includes("anomaly.js")) return [];

  const out: Source[] = [];
  const anchor = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let match: RegExpExecArray | null;

  while ((match = anchor.exec(html)) && out.length < MAX_RESULTS) {
    const url = unwrapRedirect(decodeEntities(match[1]).trim());
    const title = stripTags(match[2]).trim();
    if (!url || !title) continue;

    // A link that did not unwrap still points at the engine itself. Showing
    // "duckduckgo.com" as the domain of a result would be a plain lie, so a
    // result that resolves to the engine is dropped rather than mislabelled.
    const host = hostFromUrl(url);
    if (!host || isEngineHost(host)) continue;

    const after = html.slice(match.index + match[0].length);
    const snippetMatch = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(after);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim().slice(0, 320) : "";

    out.push(withDomain({ title: title.slice(0, 160), url, snippet, host }));
  }
  return out;
}

/** Hosts that mean a result link failed to unwrap to its real destination. */
function isEngineHost(host: string): boolean {
  return /(^|\.)duckduckgo\.com$/i.test(host);
}

/** The `www.`-stripped host of a URL, or "" when it cannot be parsed. */
function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Wikipedia search with intro extracts, which gives real quotable context. */
async function wikipedia(query: string): Promise<Source[]> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: "4",
    prop: "extracts|info",
    inprop: "url",
    exintro: "1",
    explaintext: "1",
    exsentences: "3",
    format: "json",
    origin: "*",
  });

  const response = await fetch(`${WIKI_ENDPOINT}?${params}`, {
    headers: { "User-Agent": WIKI_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return [];

  const data = (await response.json()) as {
    query?: { pages?: Record<string, { title?: string; fullurl?: string; extract?: string }> };
  };
  const pages = Object.values(data.query?.pages ?? {});

  return pages
    .filter((p) => p.title && p.fullurl)
    .map((p) =>
      withDomain({
        title: p.title!,
        url: p.fullurl!,
        snippet: (p.extract ?? "").replace(/\s+/g, " ").trim().slice(0, 320),
      }),
    );
}

/** Drops duplicate URLs, keeping the first occurrence. */
function dedupe(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const source of sources) {
    const key = source.url.replace(/\/$/, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function unwrapRedirect(url: string): string {
  try {
    const parsed = new URL(url, "https://duckduckgo.com");
    const target = parsed.searchParams.get("uddg");
    if (target) return decodeURIComponent(target);
    // Protocol-relative links like //duckduckgo.com/l/?uddg=... need the above.
    return parsed.toString();
  } catch {
    return url;
  }
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ""));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

/**
 * Renders results into the block that gets appended to the system prompt.
 * Numbered so the model can cite them, with the domain named and the exact URL
 * inline, so a citation names the site and links to the page it came from.
 */
export function formatSources(results: Source[]): string {
  if (results.length === 0) return "";
  const lines = results.map((r, i) => {
    const head = `[${i + 1}] ${r.title}`;
    const site = r.site && r.site !== r.host ? ` (${r.site})` : "";
    const domain = r.host ? `\nDomain: ${r.host}${site}` : "";
    return `${head}${domain}\n${r.url}${r.snippet ? `\n${r.snippet}` : ""}`;
  });
  return [
    "Web results for this question. Use them for facts and cite the ones you use as Markdown links.",
    "Link the exact URL given, never the site's home page, and name the site (its Domain) when you cite it.",
    "",
    ...lines,
  ].join("\n");
}
