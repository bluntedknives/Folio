"use client";

import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { CheckIcon, CopyIcon } from "./icons";
import { Graph } from "./graph/Graph";
import { parseGraphSpec } from "@/lib/graph/spec";

/**
 * Assistant output is Markdown with LaTeX. Highlighting and KaTeX run
 * client-side only, so the streaming path re-renders cheaply as text grows.
 *
 * `variant="think"` is the compact treatment used inside the reasoning panel.
 */
export const Markdown = memo(function Markdown({
  children,
  variant = "answer",
}: {
  children: string;
  variant?: "answer" | "think";
}) {
  return (
    <div className={variant === "think" ? "md md-think" : "md"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{ pre: CodeBlock, a: ExternalLink }}
      >
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  );
});

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
 * Fenced blocks. A ```graph fence becomes a live plot; everything else keeps
 * the language tag and a copy button.
 */
const GRAPH_LANGS = new Set(["graph", "plot", "chart"]);

function CodeBlock({ children }: { children?: ReactNode }) {
  const language = languageOf(children);
  const code = extractCode(children);

  if (language && GRAPH_LANGS.has(language)) return <Graph source={code} />;

  // Models sometimes nest the graph fence inside a plain fence, or glue the
  // language token to the body. Find it rather than dumping the spec as code.
  const nested = unwrapFence(code);
  if (nested) return <Graph source={nested.body} />;

  // A common failure is the model putting the tag on its own line:
  //   ```
  //   graph
  //   title: ...
  //   ```
  // which parses as an unlabelled block. Draw it when the body really is a spec.
  const tagless = detectTaglessSpec(code);
  if (tagless) return <Graph source={tagless} />;

  return (
    <CodeShell language={language} code={code}>
      {children}
    </CodeShell>
  );
}

/**
 * Recovers a graph spec from an unlabelled fence whose first line is the tag.
 * Requires the body to actually parse, so an ordinary code snippet that happens
 * to start with the word "graph" is left alone.
 */
function detectTaglessSpec(source: string): string | null {
  const lines = source.trim().split("\n");
  if (lines.length < 2) return null;
  if (!GRAPH_LANGS.has(lines[0].trim().toLowerCase())) return null;

  const body = lines.slice(1).join("\n").trim();
  if (!body) return null;
  return parseGraphSpec(body).ok ? body : null;
}

/**
 * Finds a graph fence anywhere in the text, even when a model has glued the
 * language token to the body ("```graphtitle: ...") or nested the fence inside
 * another one. Bounded work; returns null when there is nothing to draw.
 */
function unwrapFence(source: string): { body: string } | null {
  const text = source.trim();
  const open = /(?:`{3,}|~{3,})[ \t]*(graph|plot|chart)/i.exec(text);
  if (!open) return null;

  const after = text.slice(open.index + open[0].length);
  const close = /(?:`{3,}|~{3,})[ \t]*$/.exec(after);
  const body = (close ? after.slice(0, close.index) : after).trim();
  return body ? { body } : null;
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
