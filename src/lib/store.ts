import { LEGACY_STORE_NS, STORE_NS } from "./brand";
import type { Conversation, ChatMessage } from "./types";

/**
 * Local-only persistence. There is no account and nothing is uploaded.
 *
 * The record is stored under an opaque key and the payload is base64-encoded
 * JSON. This is obfuscation, not encryption: it keeps the history from being
 * casually readable in devtools or greppable in a shared browser profile.
 * Anyone with access to the machine can still decode it, so the UI says so.
 */

const KEY_PREFIX = STORE_NS;
const INDEX_KEY = `${KEY_PREFIX}::idx`;
const RECORD_PREFIX = `${KEY_PREFIX}::r::`;

/**
 * Drops the key an earlier version used to remember a manually picked model.
 * The model is now chosen per message, so the key is dead weight.
 */
export function dropLegacyModelKey(): void {
  const store = storage();
  if (!store) return;
  store.removeItem(`${KEY_PREFIX}::model`);
  for (const legacy of LEGACY_STORE_NS) store.removeItem(`${legacy}::model`);
}

function encode(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function decode<T>(raw: string): T | null {
  try {
    const binary = atob(raw);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

let migrated = false;

/**
 * Copies conversations written under an older namespace into the current one.
 * Runs once per page load, and only for ids the current namespace lacks.
 */
function migrateLegacy(): void {
  if (migrated) return;
  migrated = true;
  const store = storage();
  if (!store) return;

  for (const legacy of LEGACY_STORE_NS) {
    const legacyIndex = decode<string[]>(store.getItem(`${legacy}::idx`) ?? "");
    if (!legacyIndex?.length) continue;

    const currentIds = decode<string[]>(store.getItem(INDEX_KEY) ?? "") ?? [];
    for (const id of legacyIndex) {
      if (currentIds.includes(id)) continue;
      const raw = store.getItem(`${legacy}::r::${id}`);
      if (!raw) continue;
      try {
        store.setItem(RECORD_PREFIX + id, raw);
        currentIds.push(id);
      } catch {
        /* quota: skip this record rather than aborting the migration */
      }
    }
    store.setItem(INDEX_KEY, encode(currentIds));
  }
}

export function listConversations(): ConversationSummary[] {
  const store = storage();
  if (!store) return [];
  migrateLegacy();
  const ids = decode<string[]>(store.getItem(INDEX_KEY) ?? "") ?? [];
  const out: ConversationSummary[] = [];
  for (const id of ids) {
    const conv = readConversation(id);
    if (!conv) continue;
    out.push({
      id: conv.id,
      title: conv.title,
      updatedAt: conv.updatedAt,
      messageCount: conv.messages.length,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function readConversation(id: string): Conversation | null {
  const store = storage();
  if (!store) return null;
  return decode<Conversation>(store.getItem(RECORD_PREFIX + id) ?? "");
}

export function writeConversation(conv: Conversation): boolean {
  const store = storage();
  if (!store) return false;
  const ids = decode<string[]>(store.getItem(INDEX_KEY) ?? "") ?? [];
  if (!ids.includes(conv.id)) ids.push(conv.id);
  try {
    store.setItem(RECORD_PREFIX + conv.id, encode(conv));
    store.setItem(INDEX_KEY, encode(ids));
    return true;
  } catch {
    // Almost always the 5 MB quota: images dominate the payload.
    return false;
  }
}

export function deleteConversation(id: string): void {
  const store = storage();
  if (!store) return;
  store.removeItem(RECORD_PREFIX + id);
  const ids = decode<string[]>(store.getItem(INDEX_KEY) ?? "") ?? [];
  store.setItem(INDEX_KEY, encode(ids.filter((x) => x !== id)));
}

export function clearAll(): void {
  const store = storage();
  if (!store) return;
  for (const id of decode<string[]>(store.getItem(INDEX_KEY) ?? "") ?? []) {
    store.removeItem(RECORD_PREFIX + id);
  }
  store.removeItem(INDEX_KEY);
  for (const legacy of LEGACY_STORE_NS) {
    for (const id of decode<string[]>(store.getItem(`${legacy}::idx`) ?? "") ?? []) {
      store.removeItem(`${legacy}::r::${id}`);
    }
    store.removeItem(`${legacy}::idx`);
  }
}

/** Rough byte total of everything this app has written, for the clear-data prompt. */
export function storedBytes(): number {
  const store = storage();
  if (!store) return 0;
  let total = 0;
  for (const id of decode<string[]>(store.getItem(INDEX_KEY) ?? "") ?? []) {
    total += (store.getItem(RECORD_PREFIX + id) ?? "").length;
  }
  total += (store.getItem(INDEX_KEY) ?? "").length;
  return total;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** First user line, trimmed to something that fits the sidebar. */
export function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.content.trim());
  if (!first) return "New chat";
  const text = first.content.replace(/\s+/g, " ").trim();
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

export function emptyConversation(): Conversation {
  const now = Date.now();
  return { id: newId(), title: "New chat", createdAt: now, updatedAt: now, messages: [] };
}
