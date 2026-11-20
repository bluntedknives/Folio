import type { Conversation } from "./types";

/**
 * What the app remembers from earlier chats.
 *
 * Every chat is stored locally, and a student works through one assignment
 * across several of them: a question asked on Monday is still the context for
 * "now do part b" on Tuesday. Without this the model meets each new chat cold,
 * so the student has to re-explain work the app already has on disk.
 *
 * The memory is a digest, not the transcripts. It is built on the client, from
 * conversations already in IndexedDB, and sent with the turn. Three rules keep
 * it from becoming a privacy problem or a token bill:
 *
 *   - It is capped hard (`MAX_MEMORY_CHARS`). A digest that grows without a
 *     bound would eventually crowd out the question it is meant to support.
 *   - Only what the student wrote and what the model concluded is kept, trimmed
 *     to a line each. Attachments, sources and reasoning are never included.
 *   - The chat being answered is excluded: its turns are already in the prompt,
 *     so repeating them would be noise.
 *
 * Nothing leaves the device until a turn is sent, and then only this digest
 * travels, alongside the question the student chose to ask.
 */

/** Total characters of digest sent with one turn. */
export const MAX_MEMORY_CHARS = 2000;

/** Earlier chats considered, newest first. */
export const MAX_MEMORY_CHATS = 6;

/** Characters kept from one answer. Enough to recall the result, not the essay. */
const ANSWER_CHARS = 140;

/** Characters kept from one question. */
const QUESTION_CHARS = 160;

/** Turns read from the end of each chat. */
const TURNS_PER_CHAT = 3;

/** Characters kept from a chat's title. */
const TITLE_CHARS = 60;

function tidy(text: string, max: number): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return "";
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * One chat as a short block, or "" when it holds nothing worth remembering.
 *
 * The newest turns are read from the end because that is where the work the
 * student is continuing sits: the opening "help me with this" line is the least
 * useful part of an old chat.
 */
function digestConversation(conv: Conversation): string {
  const turns = conv.messages.filter((m) => m.role !== "system" && m.content.trim());
  if (turns.length === 0) return "";

  const recent = turns.slice(-TURNS_PER_CHAT);
  const lines: string[] = [];
  const title = tidy(conv.title, TITLE_CHARS);
  if (title && title !== "New chat") lines.push(`- ${title}`);

  for (const m of recent) {
    const text = tidy(m.content, m.role === "user" ? QUESTION_CHARS : ANSWER_CHARS);
    if (!text) continue;
    lines.push(`  ${m.role === "user" ? "asked" : "answered"}: ${text}`);
  }

  return lines.join("\n");
}

/**
 * The memory block for a turn, or "" when there is nothing to say.
 *
 * `excludeId` is the conversation being answered. Ordering is newest first, so
 * when the cap is reached the oldest chats are the ones dropped.
 */
export function buildMemory(
  conversations: Conversation[],
  { excludeId, maxChars = MAX_MEMORY_CHARS }: { excludeId?: string; maxChars?: number } = {},
): string {
  const blocks: string[] = [];
  let used = 0;

  for (const conv of conversations) {
    if (conv.id === excludeId) continue;
    const block = digestConversation(conv);
    if (!block) continue;
    // Stop before exceeding the cap rather than truncating mid-chat, so what
    // the model reads is always whole thoughts.
    if (used + block.length + 1 > maxChars) break;
    blocks.push(block);
    used += block.length + 1;
    if (blocks.length >= MAX_MEMORY_CHATS) break;
  }

  return blocks.join("\n\n");
}

/** Where the remembered digest is kept between page loads, as a toggle. */
export const MEMORY_KEY = "folio::memory";

/** True unless the student has turned earlier-chat memory off. */
export function memoryEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(MEMORY_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setMemoryEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MEMORY_KEY, on ? "on" : "off");
  } catch {
    /* private mode: the setting simply does not stick */
  }
}
