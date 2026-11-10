import { LEGACY_STORE_NS, STORE_NS } from "./brand";
import type { Conversation, ChatMessage } from "./types";

/**
 * Local-only persistence. There is no account and nothing is uploaded.
 *
 * History lives in IndexedDB rather than localStorage. The point is isolation:
 * a content script injected by a browser extension shares the page's
 * localStorage and can read it directly, but it cannot reach the page's
 * IndexedDB. Records are base64-encoded JSON on top of that, which is
 * obfuscation rather than encryption: it keeps the history from being casually
 * readable in devtools. Anyone with access to the machine can still decode it,
 * so the UI says so.
 *
 * Reads are synchronous and served from an in-memory cache that `ready()`
 * fills once per page load. Writes update the cache immediately and persist in
 * the background, so the UI never waits on the database.
 */

const DB_NAME = `${STORE_NS}-v1`;
const DB_STORE = "convos";
const LOCAL_PREFIX = STORE_NS;

/** Row shape in IndexedDB: the key is plain, the payload is encoded. */
interface StoredRow {
  id: string;
  data: string;
}

let cache = new Map<string, Conversation>();
let readyPromise: Promise<void> | null = null;
let db: IDBDatabase | null = null;

/** Resolves once the cache is populated. Safe to call more than once. */
export function ready(): Promise<void> {
  if (!readyPromise) readyPromise = hydrate();
  return readyPromise;
}

async function hydrate(): Promise<void> {
  db = await openDb();
  const stored = await idbGetAll();
  cache = new Map(stored.map((c) => [c.id, c]));
  // Always sweep localStorage: earlier versions wrote there, extensions can
  // read it, and records that predate this version still need moving across.
  await migrateFromLocalStorage();
  clearLegacyLocal();
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DB_STORE)) {
        database.createObjectStore(DB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function idbGetAll(): Promise<Conversation[]> {
  return new Promise((resolve) => {
    if (!db) return resolve([]);
    try {
      const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).getAll();
      request.onsuccess = () => {
        const rows = (request.result as StoredRow[]) ?? [];
        resolve(rows.map((row) => decode<Conversation>(row.data)).filter((c): c is Conversation => !!c));
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * The store is keyed by `id`, so the encoded payload rides in a `data` field
 * rather than being the value itself: a bare string has no `id` property and
 * would be rejected as a DataError.
 */
function idbPut(conv: Conversation): void {
  if (!db) return;
  try {
    db.transaction(DB_STORE, "readwrite")
      .objectStore(DB_STORE)
      .put({ id: conv.id, data: encode(conv) } satisfies StoredRow);
  } catch {
    /* quota or a closed connection: the in-memory copy is still correct */
  }
}

function idbDelete(id: string): void {
  if (!db) return;
  try {
    db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).delete(id);
  } catch {
    /* ignore */
  }
}

function idbClear(): void {
  if (!db) return;
  try {
    db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).clear();
  } catch {
    /* ignore */
  }
}

/** One-time move of records written by earlier versions into IndexedDB. */
async function migrateFromLocalStorage(): Promise<void> {
  if (typeof window === "undefined") return;
  const local = safeLocalStorage();
  if (!local) return;

  for (const ns of [LOCAL_PREFIX, ...LEGACY_STORE_NS]) {
    const ids = decode<string[]>(local.getItem(`${ns}::idx`) ?? "") ?? [];
    for (const id of ids) {
      // A record already in IndexedDB wins, so a re-run never clobbers newer data.
      if (cache.has(id)) continue;
      const conv = decode<Conversation>(local.getItem(`${ns}::r::${id}`) ?? "");
      if (!conv) continue;
      cache.set(conv.id, conv);
      idbPut(conv);
    }
  }
  await waitForWrites();
}

/** Best-effort wait so a migration finishes before the page is torn down. */
function waitForWrites(): Promise<void> {
  return new Promise((resolve) => {
    if (!db) return resolve();
    try {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

function clearLegacyLocal(): void {
  const local = safeLocalStorage();
  if (!local) return;
  for (const ns of [LOCAL_PREFIX, ...LEGACY_STORE_NS]) {
    const ids = decode<string[]>(local.getItem(`${ns}::idx`) ?? "") ?? [];
    for (const id of ids) local.removeItem(`${ns}::r::${id}`);
    local.removeItem(`${ns}::idx`);
    local.removeItem(`${ns}::model`);
  }
}

function safeLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
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

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export function listConversations(): ConversationSummary[] {
  return [...cache.values()]
    .map((conv) => ({
      id: conv.id,
      title: conv.title,
      updatedAt: conv.updatedAt,
      messageCount: conv.messages.length,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function readConversation(id: string): Conversation | null {
  return cache.get(id) ?? null;
}

export function writeConversation(conv: Conversation): boolean {
  cache.set(conv.id, conv);
  idbPut(conv);
  return true;
}

export function deleteConversation(id: string): void {
  cache.delete(id);
  idbDelete(id);
}

export function clearAll(): void {
  cache.clear();
  idbClear();
  clearLegacyLocal();
}

/** Rough byte total of everything this app has stored, for the clear-data prompt. */
export function storedBytes(): number {
  let total = 0;
  for (const conv of cache.values()) total += JSON.stringify(conv).length;
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
