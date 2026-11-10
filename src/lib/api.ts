import type { ChatMessage, WireMessage } from "./types";

export interface StreamHandlers {
  onReasoning: (delta: string) => void;
  onContent: (delta: string) => void;
  onDone: () => void;
}

/** Thrown for anything the UI should surface verbatim to the student. */
export class ChatError extends Error {}

/**
 * Streams a completion. Parses SSE by hand because the response mixes
 * `reasoning_content` (chain of thought) with `content` (the answer),
 * and we want to route them to different parts of the UI as they arrive.
 */
export async function streamChat(
  model: string,
  history: ChatMessage[],
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: toWire(history) }),
    signal,
  });

  if (!response.ok) {
    throw new ChatError(await readError(response));
  }
  if (!response.body) throw new ChatError("The server sent an empty response.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line.
    let split: number;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      consume(event, handlers);
    }
  }
  consume(buffer, handlers);
  handlers.onDone();
}

/** Turns app history into the compact wire format, dropping empty turns. */
function toWire(history: ChatMessage[]): WireMessage[] {
  const out: WireMessage[] = [];
  for (const m of history) {
    if (m.role === "system") continue;
    const content = m.content ?? "";
    const images = (m.attachments ?? []).map((a) => a.dataUrl);
    if (!content.trim() && images.length === 0) continue;
    out.push({ role: m.role, content, images: images.length ? images : undefined });
  }
  return out;
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown };
    if (typeof data.error === "string" && data.error) return data.error;
  } catch {
    /* fall through */
  }
  return `Request failed with status ${response.status}.`;
}

function consume(event: string, handlers: StreamHandlers): void {
  if (!event.startsWith("data:")) return;
  const payload = event.slice(5).trim();
  if (!payload) return;
  let chunk;
  try {
    chunk = JSON.parse(payload);
  } catch {
    return;
  }
  const delta = chunk?.choices?.[0]?.delta;
  if (!delta) return;
  if (typeof delta.reasoning_content === "string") handlers.onReasoning(delta.reasoning_content);
  if (typeof delta.content === "string") handlers.onContent(delta.content);
}
