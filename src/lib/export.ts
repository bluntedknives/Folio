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
      out.push(`*[image: ${attachment.label}]*`, "");
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
