import type { Attachment, ChatMessage, Source, WireMessage, WirePart } from "./types";
import { withDomain } from "./domain";
import { latestVideoId } from "./youtube";

export interface StreamHandlers {
  onReasoning: (delta: string) => void;
  onContent: (delta: string) => void;
  onSources: (sources: Source[]) => void;
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
  query: string,
  signal: AbortSignal,
  handlers: StreamHandlers,
): Promise<void> {
  // The video the newest turn is about, if any. Sent as an id rather than as
  // metadata: the server re-reads the video, so nothing about it is stored and
  // a title can never go stale.
  const videoId = latestVideoId(history.map((m) => ({ role: m.role, content: m.content })));

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: toWire(history),
      query,
      videoId: videoId ?? undefined,
    }),
    signal,
  });

  if (!response.ok) {
    throw new ChatError(await readError(response));
  }
  if (!response.body) throw new ChatError("The server sent an empty response.");

  // Search results ride along on a header, since the body is a raw SSE stream.
  handlers.onSources(readSources(response.headers.get("X-Folio-Sources")));

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
    const parts = toParts(m.attachments ?? []);
    if (!content.trim() && parts.length === 0) continue;
    out.push({ role: m.role, content, parts: parts.length ? parts : undefined });
  }
  return out;
}

/**
 * Builds the multimodal parts. Images become image parts, audio becomes an
 * input_audio part with the base64 payload split off its data URL, a video
 * becomes a video_url part carrying the whole data URL, and a document
 * contributes its extracted text plus its rendered pages as images.
 *
 * Two limits are enforced by the API and mirrored here. A request may carry at
 * most one video, so only the first is sent. A request may not mix a video with
 * a separate audio part while the video's own soundtrack is being listened to,
 * so when a video is present the standalone audio is left out rather than
 * failing the whole turn.
 */
function toParts(attachments: Attachment[]): WirePart[] {
  const parts: WirePart[] = [];
  const notes: string[] = [];

  const video = attachments.find((a) => a.kind === "video");
  const videos = attachments.filter((a) => a.kind === "video");

  for (const a of attachments) {
    if (a.kind === "image") {
      parts.push({ type: "image_url", image_url: { url: a.dataUrl } });
      notes.push(`Attached image: ${a.name}.`);
      continue;
    }

    if (a.kind === "document") {
      parts.push({ type: "image_url", image_url: { url: a.dataUrl } });
      const page = a.pages && a.pages > 1 ? ` (page ${pageNumber(a.name)} of ${a.pages})` : "";
      notes.push(`Attached document: ${a.name}${page}.`);
      if (a.text) {
        parts.push({ type: "text", text: `Extracted text from ${a.name}:\n${a.text}` });
      }
      continue;
    }

    if (a.kind === "video") {
      if (a !== video) continue;
      parts.push({ type: "video_url", video_url: { url: a.dataUrl } });
      const seconds = a.duration ? ` (${a.duration.toFixed(0)}s)` : "";
      const sound = a.hasAudio ? " with sound" : " (no sound track)";
      notes.push(`Attached video clip: ${a.name}${seconds}${sound}.`);
      if (videos.length > 1) {
        notes.push(`Only ${a.name} was sent; one video per message.`);
      }
      continue;
    }

    if (a.kind === "audio") {
      // The video's own soundtrack is heard instead, and sending both is
      // rejected outright.
      if (video) continue;
      const { format, data } = splitAudioDataUrl(a.dataUrl);
      if (data) {
        parts.push({ type: "input_audio", input_audio: { data, format } });
        notes.push(`Attached audio clip: ${a.name}.`);
      }
    }
  }

  if (notes.length) parts.unshift({ type: "text", text: notes.join(" ") });
  return parts;
}

function pageNumber(name: string): number {
  const match = /page (\d+)/i.exec(name);
  return match ? Number(match[1]) : 1;
}

/** Pulls the base64 body and the format token out of an audio data URL. */
function splitAudioDataUrl(dataUrl: string): { format: string; data: string } {
  const match = /^data:audio\/([a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return { format: "", data: "" };
  const subtype = match[1].toLowerCase();
  // NVIDIA expects the bare container name, and "mpeg" means an MP3.
  const format = subtype === "mpeg" ? "mp3" : subtype === "x-wav" ? "wav" : subtype;
  return { format, data: match[2] };
}

function readSources(header: string | null): Source[] {
  if (!header) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(header)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is Source =>
          typeof s === "object" &&
          s !== null &&
          typeof (s as Source).url === "string" &&
          typeof (s as Source).title === "string",
      )
      // The server sets `host` and `site`, but a cached or older response may
      // not, so they are filled in from the URL rather than left undefined.
      .map((s) => withDomain({ ...s, snippet: s.snippet ?? "" }));
  } catch {
    return [];
  }
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
