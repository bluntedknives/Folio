"use client";

import { createContext, memo, useContext, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { CheckIcon, CopyIcon } from "./icons";
import { CiteChip } from "./CiteChip";
import { Graph } from "./graph/Graph";
import { Deck } from "./slides/Deck";
import { parseGraphSpec } from "@/lib/graph/spec";
import { parseDeck } from "@/lib/slides/spec";
import { normalizeUrl } from "@/lib/domain";
import type { Source } from "@/lib/types";

/**
 * Assistant output is Markdown with LaTeX. Highlighting and KaTeX run
 * client-side only, so the streaming path re-renders cheaply as text grows.
 *
 * `variant="think"` is the compact treatment used inside the reasoning panel.
 *
 * When `sources` is given, a citation becomes an inline chip: a bare `[n]`
 * marker, a Markdown link, or a pasted URL that points at one of the results is
 * replaced by a chip naming the site. Models cite in all three ways, so all
 * three are handled rather than showing a raw bracket or a long URL.
 */
export const Markdown = memo(function Markdown({
  children,
  variant = "answer",
  sources,
  onAsk,
}: {
  children: string;
  variant?: "answer" | "think";
  sources?: Source[];
  /** Sends a follow-up from inside a rendered block, e.g. a deck's edit request. */
  onAsk?: (text: string) => void;
}) {
  const byUrl = sources?.length ? sourceIndex(sources) : null;
  const components = {
    pre: PreBlock,
    a: byUrl ? citationLink(byUrl, sources!) : ExternalLink,
    ...(byUrl ? { code: inlineCitation(sources!) } : {}),
  };

  return (
    <AskContext.Provider value={onAsk}>
      <div className={variant === "think" ? "md md-think" : "md"}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
          components={components}
        >
          {byUrl ? withCitationMarkers(normalizeMath(children)) : normalizeMath(children)}
        </ReactMarkdown>
      </div>
    </AskContext.Provider>
  );
});

/** Normalized URL of each result to its 1-based position. */
function sourceIndex(sources: Source[]): Map<string, number> {
  const index = new Map<string, number>();
  sources.forEach((source, i) => {
    const key = normalizeUrl(source.url);
    if (key && !index.has(key)) index.set(key, i + 1);
  });
  return index;
}

/**
 * A link that points at one of the results becomes a chip, whether the model
 * wrote `[n](url)` or pasted a bare URL (GFM autolinks the latter). Any other
 * link stays an ordinary external link.
 */
function citationLink(byUrl: Map<string, number>, sources: Source[]) {
  return function CitationLink({ href, children }: { href?: string; children?: ReactNode }) {
    const n = href ? byUrl.get(normalizeUrl(href)) : undefined;
    if (n) return <CiteChip n={n} source={sources[n - 1]} />;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  };
}

/**
 * A `[n]` marker in the answer, rendered as a chip. Markers are rewritten to an
 * inline code span carrying a sentinel first, so this sees them as inline code
 * and can swap in the chip.
 */
function inlineCitation(sources: Source[]) {
  return function InlineCode({
    children,
    className,
  }: {
    children?: ReactNode;
    className?: string;
  }) {
    if (!className) {
      const match = /^\uE000(\d{1,2})\uE000$/.exec(extractCode(children));
      if (match) {
        const n = Number(match[1]);
        return <CiteChip n={n} source={sources[n - 1]} />;
      }
    }
    return <code className={className}>{children}</code>;
  };
}

/**
 * Rewrites bare `[n]` citation markers to an inline code span carrying a
 * private-use sentinel, which the renderer turns into a chip. Fenced blocks and
 * inline code are left alone, since a snippet may contain brackets that mean
 * something else. A `[n](url)` link is not a marker and is left as a link.
 */
function withCitationMarkers(source: string): string {
  return source
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(/\[(\d{1,2})\](?!\()/g, "`\uE000$1\uE000`");
    })
    .join("");
}

/**
 * Most models write inline maths as \( ... \) and display maths as
 * \[ ... \]. remark-math only understands the dollar form, so rewrite the
 * delimiters. Fenced code is left untouched, since a snippet may legitimately
 * contain a backslash-paren.
 */
function normalizeMath(source: string): string {
  return source
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => `$$${body.trim()}$$`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => `$${body.trim()}$`);
    })
    .join("");
}

/**
 * Fenced blocks. A ```graph fence becomes a live plot and a ```slides fence
 * becomes a deck; everything else keeps the language tag and a copy button.
 */
const GRAPH_LANGS = new Set(["graph", "plot", "chart"]);
const DECK_LANGS = new Set(["slides", "deck", "presentation", "slide"]);

/**
 * The chat's follow-up sender, shared with rendered blocks. It travels by
 * context rather than by prop because the `pre` renderer must be a stable
 * module-level component: React remounts a subtree whose component type changes,
 * so a handler baked into a per-render closure would reset a deck on every
 * keystroke in the composer.
 */
const AskContext = createContext<((text: string) => void) | undefined>(undefined);

function PreBlock({ children }: { children?: ReactNode }) {
  return <CodeBlockBody onAsk={useContext(AskContext)}>{children}</CodeBlockBody>;
}

/**
 * The fence renderer. A module-level component, not one built inside the
 * `Markdown` render, so the identity of the element type never changes.
 */
function CodeBlockBody({ children, onAsk }: { children?: ReactNode; onAsk?: (text: string) => void }) {
  const language = languageOf(children);
  const code = extractCode(children);

  if (language && GRAPH_LANGS.has(language)) return <Graph source={code} />;
  if (language && DECK_LANGS.has(language)) return <Deck source={code} onAsk={onAsk} />;

  // Models sometimes nest the fence inside a plain fence, or glue the language
  // token to the body. Find it rather than dumping the spec as code.
  const nestedGraph = unwrapFence(code, GRAPH_LANGS);
  if (nestedGraph) return <Graph source={nestedGraph} />;
  const nestedDeck = unwrapFence(code, DECK_LANGS);
  if (nestedDeck) return <Deck source={nestedDeck} onAsk={onAsk} />;

  // A common failure is the model putting the tag on its own line:
  //   ```
  //   slides
  //   # Title
  //   ```
  // which parses as an unlabelled block. Render it when the body really parses.
  const taglessGraph = detectTaglessSpec(code, GRAPH_LANGS, (body) => parseGraphSpec(body).ok);
  if (taglessGraph) return <Graph source={taglessGraph} />;
  const taglessDeck = detectTaglessSpec(code, DECK_LANGS, looksLikeDeck);
  if (taglessDeck) return <Deck source={taglessDeck} onAsk={onAsk} />;

  return (
    <CodeShell language={language} code={code}>
      {children}
    </CodeShell>
  );
}

/**
 * True when a body really is a deck, not a code snippet that happens to start
 * with the word "slides". Requires a parse and at least two slides, since a
 * deck worth rendering is never one slide, and a one-line snippet that starts
 * with the tag must stay code.
 */
function looksLikeDeck(body: string): boolean {
  const parsed = parseDeck(body);
  return parsed.ok && parsed.deck.slides.length >= 2;
}

/**
 * Recovers a spec from an unlabelled fence whose first line is the tag.
 * Requires the body to actually parse, so an ordinary code snippet that happens
 * to start with the word "graph" is left alone.
 */
function detectTaglessSpec(
  source: string,
  langs: Set<string>,
  parses: (body: string) => boolean,
): string | null {
  const lines = source.trim().split("\n");
  if (lines.length < 2) return null;
  if (!langs.has(lines[0].trim().toLowerCase())) return null;

  const body = lines.slice(1).join("\n").trim();
  if (!body) return null;
  return parses(body) ? body : null;
}

/**
 * Finds a fence of one of `langs` anywhere in the text, even when a model has
 * glued the language token to the body ("```slidestitle: ...") or nested the
 * fence inside another one. Bounded work; returns null when there is nothing.
 */
function unwrapFence(source: string, langs: Set<string>): string | null {
  const text = source.trim();
  const names = [...langs].join("|");
  const open = new RegExp(`(?:\`{3,}|~{3,})[ \\t]*(${names})`, "i").exec(text);
  if (!open) return null;

  const after = text.slice(open.index + open[0].length);
  const close = /(?:`{3,}|~{3,})[ \t]*$/.exec(after);
  const body = (close ? after.slice(0, close.index) : after).trim();
  return body ? body : null;
}

function CodeShell({
  language,
  code,
  children,
}: {
  language: string | null;
  code: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked; leave the button in its idle state */
    }
  }

  return (
    <div className="code-shell">
      <div className="code-head">
        <span className="code-lang">{language ?? "code"}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
          className="code-copy"
        >
          {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="code-body">{children}</div>
    </div>
  );
}

function ExternalLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  );
}

/** Pulls the raw text out of the <code> element rehype-highlight produced. */
function extractCode(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractCode).join("");
  const props = (node as { props?: { children?: ReactNode } }).props;
  return props ? extractCode(props.children) : "";
}

/** Reads the language from the `language-x` class the highlighter adds. */
function languageOf(node: ReactNode): string | null {
  if (node === null || node === undefined || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = languageOf(child);
      if (found) return found;
    }
    return null;
  }
  const props = (node as { props?: { className?: string; children?: ReactNode } }).props;
  if (!props) return null;
  const match = /language-([\w+#-]+)/.exec(props.className ?? "");
  if (match) return match[1];
  return languageOf(props.children);
}
