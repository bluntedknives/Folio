import type { Source } from "./types";

/**
 * Domain handling for search results, shared by the server that builds them and
 * the client that draws them.
 *
 * The host is always derived from the final result URL rather than from the
 * search engine's own display string. That is the whole point: the engine's
 * label and the link can disagree, and the label is the one a student reads and
 * trusts. Deriving both the label and the link from the same URL makes a
 * mismatch impossible.
 */

/** Registry suffixes that are two labels, so `co.uk` does not become a domain. */
const TWO_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk",
  "co.jp", "or.jp", "ne.jp", "ac.jp", "go.jp", "co.kr", "or.kr", "co.in",
  "co.nz", "net.nz", "org.nz", "gov.au", "com.au", "net.au", "org.au",
  "edu.au", "co.za", "org.za", "com.br", "com.mx", "com.ar", "com.tr",
  "com.cn", "com.hk", "com.sg", "com.tw", "co.il", "com.my", "com.ph",
]);

/**
 * The registrable domain for a host: the host with `www.` removed, and with
 * subdomains collapsed to the name and its suffix (`blog.example.co.uk` ->
 * `example.co.uk`). Kept deliberately simple; it needs to be right for the
 * common cases, not to be a full public-suffix list.
 */
export function registrableDomain(host: string): string {
  const clean = host.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!clean) return "";
  const parts = clean.split(".");
  if (parts.length <= 2) return clean;

  const lastTwo = parts.slice(-2).join(".");
  if (TWO_PART_TLDS.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

/** The path part of a URL, without the leading slash or trailing slash. */
export function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    return "";
  }
}

/**
 * A readable site name for a domain. Known sites get their real name, so the
 * panel reads "Wikipedia" rather than "en.wikipedia.org"; everything else is
 * title-cased from its registrable domain.
 */
const SITE_NAMES: Record<string, string> = {
  "wikipedia.org": "Wikipedia",
  "britannica.com": "Britannica",
  "khanacademy.org": "Khan Academy",
  "github.com": "GitHub",
  "stackoverflow.com": "Stack Overflow",
  "mathworld.wolfram.com": "MathWorld",
  "wolframalpha.com": "Wolfram Alpha",
  "arxiv.org": "arXiv",
  "nature.com": "Nature",
  "science.org": "Science",
  "sciencedirect.com": "ScienceDirect",
  "ncbi.nlm.nih.gov": "NCBI",
  "who.int": "WHO",
  "nasa.gov": "NASA",
  "noaa.gov": "NOAA",
  "nist.gov": "NIST",
  "cdc.gov": "CDC",
  "nih.gov": "NIH",
  "edu.gov": "Department of Education",
  "history.com": "HISTORY",
  "nationalgeographic.com": "National Geographic",
  "smithsonianmag.com": "Smithsonian",
  "loc.gov": "Library of Congress",
  "britishmuseum.org": "British Museum",
  "si.edu": "Smithsonian",
  "openstax.org": "OpenStax",
  "coursera.org": "Coursera",
  "mit.edu": "MIT",
  "stanford.edu": "Stanford",
  "harvard.edu": "Harvard",
  "physicsclassroom.com": "The Physics Classroom",
  "chem.libretexts.org": "Chemistry LibreTexts",
  "math.libretexts.org": "Math LibreTexts",
  "libretexts.org": "LibreTexts",
  "reuters.com": "Reuters",
  "apnews.com": "AP News",
  "bbc.com": "BBC",
  "bbc.co.uk": "BBC",
  "nytimes.com": "The New York Times",
  "theguardian.com": "The Guardian",
  "washingtonpost.com": "The Washington Post",
  "economist.com": "The Economist",
  "pbs.org": "PBS",
  "npr.org": "NPR",
};

export function siteName(domain: string): string {
  if (!domain) return "";
  const known = SITE_NAMES[domain];
  if (known) return known;
  const base = domain.split(".")[0];
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The initial to draw in a source's badge. */
export function monogram(domain: string): string {
  const name = domain.replace(/^www\./, "");
  return (name.charAt(0) || "?").toUpperCase();
}

/**
 * Fills in `host` and `site` from the URL when a source does not already carry
 * them. Every path that produces a `Source` runs through here, so the fields
 * are never missing at the point of display.
 */
export function withDomain(source: Source): Source {
  const host = source.host || hostOf(source.url);
  return {
    ...source,
    host,
    site: source.site || siteName(registrableDomain(host)),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Keeps at most `perDomain` results from any one registrable domain. */
export function capPerDomain(sources: Source[], perDomain: number): Source[] {
  const counts = new Map<string, number>();
  const out: Source[] = [];
  for (const source of sources) {
    const domain = registrableDomain(source.host || hostOf(source.url));
    const seen = counts.get(domain) ?? 0;
    if (domain && seen >= perDomain) continue;
    counts.set(domain, seen + 1);
    out.push(source);
  }
  return out;
}

/**
 * A URL reduced to what two links must share to be "the same page": the host
 * lowercased and `www.`-stripped, the trailing slash dropped, and the hash and
 * tracking parameters ignored. Used to match a citation the model wrote against
 * the result it came from, so a citation chip is only shown when the link
 * really is one of the sources.
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (isTrackingParam(key)) parsed.searchParams.delete(key);
    }
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "");
    const query = parsed.searchParams.toString();
    return `${host}${path}${query ? `?${query}` : ""}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

const TRACKING_PARAMS = new Set(["fbclid", "gclid", "ref", "ref_src", "source", "igshid", "mc_cid", "mc_eid"]);

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMS.has(lower);
}

/**
 * Maps each source's normalized URL to its 1-based position, so a citation in
 * the answer can be matched back to the result it came from.
 */
export function citationIndex(sources: Source[]): Map<string, number> {
  const index = new Map<string, number>();
  sources.forEach((source, i) => {
    const key = normalizeUrl(source.url);
    if (key && !index.has(key)) index.set(key, i + 1);
  });
  return index;
}
