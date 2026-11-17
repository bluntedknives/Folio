/**
 * Parses a ```slides fenced block into a renderable deck.
 *
 * Deliberately a forgiving line language rather than JSON, for the same reason
 * as `graph/spec.ts`: a model asked for a presentation writes this shape far
 * more reliably than it writes valid JSON, and a student can fix a line by hand.
 *
 *   slides
 *   title: The Water Cycle
 *   subtitle: Grade 7 Science
 *   theme: slate
 *
 *   # The Water Cycle
 *   layout: title
 *   The continuous movement of water on, above and below the surface.
 *
 *   ---
 *
 *   # Evaporation
 *   The sun heats liquid water until it becomes vapour.
 *   - Happens in oceans, lakes and rivers
 *   - Fastest in direct sunlight
 *   note: The sun is the energy source.
 *
 * `---` separates slides. A `#` heading also starts a new slide, so a deck the
 * model forgot to separate still comes out as separate slides rather than one
 * enormous one. Everything before the first heading is the deck header.
 */

export type SlideLayout = "title" | "section" | "bullets" | "quote" | "code" | "split";

export interface Slide {
  title: string;
  /** Optional second line under the title. */
  subtitle: string;
  layout: SlideLayout;
  /** Paragraph lines, in order. */
  body: string[];
  bullets: string[];
  /** True when the bullets are a numbered list. */
  ordered: boolean;
  quote: string;
  code: { lang: string; text: string } | null;
  /** http(s) or data URL, drawn as a picture. */
  image: string;
  /** Speaker notes. Shown in the editor, hidden while presenting. */
  notes: string;
}

export interface Deck {
  title: string;
  subtitle: string;
  theme: DeckTheme;
  footer: string;
  slides: Slide[];
}

export type DeckTheme = "slate" | "paper" | "contrast" | "dusk" | "mint";

export const DECK_THEMES: { id: DeckTheme; label: string }[] = [
  { id: "slate", label: "Slate" },
  { id: "paper", label: "Paper" },
  { id: "contrast", label: "Contrast" },
  { id: "dusk", label: "Dusk" },
  { id: "mint", label: "Mint" },
];

export type DeckParse = { ok: true; deck: Deck } | { ok: false; error: string };

/** Slide layouts a model may name, mapped from the words it actually uses. */
const LAYOUT_ALIASES: Record<string, SlideLayout> = {
  title: "title",
  cover: "title",
  opener: "title",
  section: "section",
  divider: "section",
  bullets: "bullets",
  list: "bullets",
  bullet: "bullets",
  content: "bullets",
  quote: "quote",
  quotation: "quote",
  code: "code",
  split: "split",
  columns: "split",
  "two-column": "split",
};

const THEMES = new Set<string>(DECK_THEMES.map((t) => t.id));

/**
 * Characters a model may emit that mean something else once parsed: the bullet
 * glyph it may paste instead of a hyphen, and the non-breaking space it uses
 * inside copied prose.
 */
function normaliseLine(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/^\s*[\u2022\u00b7\u25aa\u25cf]\s+/, "- ")
    .trimEnd();
}

/** "theme: slate", "layout: title", "note: ..." as a key and a value. */
function keyValue(line: string): { key: string; value: string } | null {
  const match = /^([A-Za-z][A-Za-z -]{0,18})\s*:\s*(.*)$/.exec(line.trim());
  if (!match) return null;
  return { key: match[1].trim().toLowerCase(), value: match[2].trim() };
}

function emptySlide(): Slide {
  return {
    title: "",
    subtitle: "",
    layout: "bullets",
    body: [],
    bullets: [],
    ordered: false,
    quote: "",
    code: null,
    image: "",
    notes: "",
  };
}

/**
 * Reads a deck. Never throws: an unreadable line is skipped rather than failing
 * the whole deck, because a deck with one odd line still has slides in it, and
 * refusing to show anything is the worst outcome for a student.
 */
export function parseDeck(source: string): DeckParse {
  const lines = source.replace(/\t/g, "    ").split("\n").map(normaliseLine);

  const deck: Deck = { title: "", subtitle: "", theme: "slate", footer: "", slides: [] };
  let slide = emptySlide();
  let started = false;
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  const pushSlide = () => {
    // A slide with nothing on it is a stray separator, not a slide.
    if (started && hasContent(slide)) deck.slides.push(slide);
    slide = emptySlide();
  };

  for (const raw of lines) {
    const line = raw.trim();

    // Inside a fence, every line is code, including a line that looks like a
    // heading or a separator.
    if (inCode) {
      if (/^\s*(?:`{3,}|~{3,})\s*$/.test(raw)) {
        slide.code = { lang: codeLang, text: codeLines.join("\n").replace(/\n+$/, "") };
        if (slide.layout === "bullets") slide.layout = "code";
        inCode = false;
        codeLines = [];
        codeLang = "";
      } else {
        codeLines.push(raw.trimEnd());
      }
      continue;
    }

    const fence = /^\s*(?:`{3,}|~{3,})\s*([\w+#.-]*)\s*$/.exec(raw);
    if (fence) {
      if (!started) started = true;
      inCode = true;
      codeLang = fence[1] ?? "";
      continue;
    }

    if (!line) continue;

    // The tag sometimes lands on a line of its own.
    if (!started && /^(slides|deck|presentation|slide)$/i.test(line)) continue;

    // A separator, a heading, or the very first line starts a new slide.
    if (/^([-*_])\1{2,}$/.test(line.replace(/\s/g, ""))) {
      pushSlide();
      started = true;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      // A `#` always begins a new slide, even with no `---` before it.
      pushSlide();
      started = true;
      slide.title = heading[2].trim();
      continue;
    }

    const pair = keyValue(line);

    if (!started) {
      // The header block, before the first slide.
      if (pair) {
        const { key, value } = pair;
        if (key === "title") deck.title = value;
        else if (key === "subtitle" || key === "by" || key === "author") deck.subtitle = value;
        else if (key === "footer") deck.footer = value;
        else if (key === "theme") deck.theme = themeOf(value);
        else if (key === "slide" || key === "slides") {
          started = true;
          if (value) slide.title = value;
        }
        continue;
      }
      // A bare line before any heading is the deck's first slide starting.
      started = true;
      slide.body.push(line);
      continue;
    }

    if (pair) {
      const { key, value } = pair;
      if (key === "title") {
        slide.title = value;
        continue;
      }
      if (key === "subtitle" || key === "sub" || key === "by") {
        slide.subtitle = value;
        continue;
      }
      if (key === "layout") {
        slide.layout = LAYOUT_ALIASES[value.toLowerCase()] ?? slide.layout;
        continue;
      }
      if (key === "note" || key === "notes" || key === "speaker") {
        slide.notes = value;
        continue;
      }
      if (key === "image" || key === "picture" || key === "img") {
        slide.image = value;
        continue;
      }
      if (key === "footer") {
        deck.footer = value;
        continue;
      }
      if (key === "theme") {
        deck.theme = themeOf(value);
        continue;
      }
      if (key === "slide") {
        pushSlide();
        slide.title = value;
        continue;
      }
    }

    // A quote line, written with `>` or tagged as one.
    if (line.startsWith(">")) {
      const text = line.replace(/^>\s?/, "").trim();
      slide.quote = slide.quote ? `${slide.quote} ${text}` : text;
      if (slide.layout === "bullets") slide.layout = "quote";
      continue;
    }

    // A bullet: `-`, `*`, or a number followed by `.` or `)`.
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      slide.bullets.push(bullet[1].trim());
      continue;
    }
    const numbered = /^(\d{1,3})[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      slide.bullets.push(numbered[2].trim());
      slide.ordered = true;
      continue;
    }

    // A whole line in bold is the slide's second line, not a heading: a slide
    // has only one title.
    const sub = /^(?:\*\*|__)(.+?)(?:\*\*|__)$/.exec(line);
    if (sub && !slide.subtitle && !slide.body.length) {
      slide.subtitle = sub[1].trim();
      continue;
    }

    slide.body.push(line);
  }

  // A fence left open at the end still carries its code.
  if (inCode && codeLines.length) {
    slide.code = { lang: codeLang, text: codeLines.join("\n").replace(/\n+$/, "") };
    if (slide.layout === "bullets") slide.layout = "code";
  }
  pushSlide();

  if (deck.slides.length === 0) {
    return { ok: false, error: "A deck needs at least one slide. Start one with a # heading." };
  }

  if (!deck.title) deck.title = deck.slides[0].title || "Presentation";
  return { ok: true, deck };
}

/** True when a slide has anything worth showing. */
function hasContent(slide: Slide): boolean {
  return Boolean(
    slide.title ||
      slide.subtitle ||
      slide.body.length ||
      slide.bullets.length ||
      slide.quote ||
      slide.code ||
      slide.image,
  );
}

function themeOf(value: string): DeckTheme {
  const key = value.trim().toLowerCase().replace(/\s+/g, "-");
  return THEMES.has(key) ? (key as DeckTheme) : "slate";
}

/**
 * The layout to actually draw. A model often leaves the layout unset, so this
 * infers the obvious one: an opening slide with just a title and a line is a
 * cover, a lone quote is a quote, and a lone code block is code.
 */
export function effectiveLayout(slide: Slide, index: number): SlideLayout {
  if (slide.layout !== "bullets") return slide.layout;
  if (index === 0 && !slide.bullets.length && !slide.code && !slide.quote && !slide.image) {
    return "title";
  }
  if (slide.quote && !slide.bullets.length) return "quote";
  if (slide.code && !slide.bullets.length && !slide.body.length) return "code";
  return "bullets";
}

/**
 * Serialises a deck back to the fence body, so an edited deck can be copied,
 * exported or re-read. Round-trips through `parseDeck`.
 */
export function toDeckFence(deck: Deck): string {
  const out: string[] = ["slides", `title: ${deck.title}`];
  if (deck.subtitle) out.push(`subtitle: ${deck.subtitle}`);
  if (deck.footer) out.push(`footer: ${deck.footer}`);
  out.push(`theme: ${deck.theme}`);

  deck.slides.forEach((slide) => {
    out.push("", "---", "", `# ${slide.title || "Untitled"}`);
    if (slide.layout !== "bullets") out.push(`layout: ${slide.layout}`);
    if (slide.subtitle) out.push("", slide.subtitle);
    if (slide.image) out.push(`image: ${slide.image}`);
    for (const line of slide.body) out.push("", line);
    if (slide.quote) out.push("", `> ${slide.quote}`);
    if (slide.bullets.length) {
      out.push("");
      slide.bullets.forEach((item, i) =>
        out.push(slide.ordered ? `${i + 1}. ${item}` : `- ${item}`),
      );
    }
    if (slide.code) out.push("", "```" + slide.code.lang, slide.code.text, "```");
    if (slide.notes) out.push("", `note: ${slide.notes}`);
  });

  return out.join("\n");
}

/** Plain-text outline of a deck, for a quick copy or a paste into a doc. */
export function deckOutline(deck: Deck): string {
  const out = [`# ${deck.title}`];
  if (deck.subtitle) out.push(deck.subtitle);
  deck.slides.forEach((slide, i) => {
    out.push("", `## ${i + 1}. ${slide.title || "Untitled"}`);
    if (slide.subtitle) out.push(slide.subtitle);
    for (const line of slide.body) out.push(line);
    if (slide.quote) out.push(`> ${slide.quote}`);
    for (const item of slide.bullets) out.push(`- ${item}`);
  });
  return out.join("\n");
}
