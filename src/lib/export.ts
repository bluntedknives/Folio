import { BRAND } from "./brand";
import type { Conversation } from "./types";

/** Renders a conversation as Markdown, for the export button. */
export function conversationToMarkdown(conversation: Conversation): string {
  const out: string[] = [`# ${conversation.title}`, ""];

  for (const message of conversation.messages) {
    if (!message.content.trim() && !message.reasoning?.trim() && !message.attachments?.length) {
      continue;
    }
    out.push(message.role === "user" ? "## You" : `## ${BRAND.name}`);

    for (const attachment of message.attachments ?? []) {
      out.push(`*[${attachment.kind}: ${attachment.name}]*`, "");
    }
    if (message.content.trim()) out.push(message.content.trim(), "");
    if (message.error) out.push(`> ${message.error}`, "");
  }

  out.push("---", `Exported from ${BRAND.name}.`);
  return out.join("\n");
}

/** Triggers a client-side download of a text file. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** A filesystem-safe version of a conversation title. */
export function safeFilename(title: string): string {
  const cleaned = title
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48)
    .toLowerCase();
  return `${cleaned || "chat"}.md`;
}

/**
 * Copies an assistant answer in a form that survives the paste.
 *
 * Plain text keeps the Markdown readable (headings, `code`, lists), while the
 * HTML flavour lets rich editors such as Docs, Word and Notion keep real
 * headings, bold text and code blocks instead of pasting a wall of asterisks.
 * Both flavours are written together so the receiving app picks the best one.
 */
export async function copyFormatted(markdown: string): Promise<void> {
  const plain = markdown.trim();
  if (!plain) return;

  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plain], { type: "text/plain" }),
          "text/html": new Blob([markdownToHtml(plain)], { type: "text/html" }),
        }),
      ]);
      return;
    }
  } catch {
    /* fall through to the plain-text path */
  }

  await navigator.clipboard.writeText(plain);
}

/**
 * A deliberately small Markdown to HTML converter, scoped to what answers
 * actually contain: headings, bold/italic, inline code, fenced code, lists,
 * blockquotes and links. It is not a general Markdown implementation.
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  const inline = (text: string) =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\W)\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2">$1</a>',
      );

  for (const line of lines) {
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      if (inCode) {
        out.push(
          `<pre><code${codeLang ? ` class="language-${codeLang}"` : ""}>${escapeHtml(
            codeLines.join("\n"),
          )}</code></pre>`,
        );
        inCode = false;
        codeLines = [];
        codeLang = "";
      } else {
        closeList();
        inCode = true;
        codeLang = fence[1] ?? "";
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const wanted: "ul" | "ol" = bullet ? "ul" : "ol";
      if (listType !== wanted) {
        closeList();
        out.push(`<${wanted}>`);
        listType = wanted;
      }
      out.push(`<li>${inline((bullet ?? numbered)![1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }

  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  closeList();
  return out.join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
