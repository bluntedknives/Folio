import { NextResponse } from "next/server";
import { MODELS, getModel, type ModelInfo } from "@/lib/models";
import type { WireMessage, WirePart } from "@/lib/types";

const MAX_MESSAGES = 40;
const MAX_CHARS_PER_MESSAGE = 20000;
const MAX_PARTS = 10;
const MAX_PART_CHARS = 24_000_000;
const MAX_BODY_CHARS = 64_000_000;

export interface ChatRequestBody {
  model: string;
  messages: WireMessage[];
  /** The user's own words for this turn, used to decide on a web search. */
  query: string;
}

export type ParseResult =
  | { ok: true; body: ChatRequestBody }
  | { ok: false; response: NextResponse };

export async function readChatRequest(request: Request): Promise<ParseResult> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_CHARS) {
    return { ok: false, response: fail(413, "That request is too large. Try a smaller file.") };
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: fail(400, "Malformed request body.") };
  }

  if (typeof raw !== "object" || raw === null) return { ok: false, response: fail(400, "Malformed request body.") };
  const body = raw as Record<string, unknown>;

  if (typeof body.model !== "string" || !getModel(body.model)) {
    return { ok: false, response: fail(400, `Unknown model. Allowed: ${MODELS.map((m) => m.id).join(", ")}.`) };
  }
  const model = getModel(body.model)!;

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { ok: false, response: fail(400, "No messages were sent.") };
  }
  if (body.messages.length > MAX_MESSAGES) {
    return { ok: false, response: fail(413, `Too many messages. The limit is ${MAX_MESSAGES}.`) };
  }

  const messages: WireMessage[] = [];
  for (let i = 0; i < body.messages.length; i++) {
    const entry = body.messages[i];
    if (typeof entry !== "object" || entry === null) return { ok: false, response: fail(400, "Malformed message.") };
    const m = entry as Record<string, unknown>;
    if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") {
      return { ok: false, response: fail(400, "Malformed message role.") };
    }
    if (typeof m.content !== "string") return { ok: false, response: fail(400, "Malformed message content.") };
    if (m.content.length > MAX_CHARS_PER_MESSAGE) {
      return { ok: false, response: fail(413, "A message in this chat is too long.") };
    }

    const isLatest = i === body.messages.length - 1;
    const parts = readParts(m.parts, model, isLatest);
    if (!parts.ok) return parts;

    if (!m.content.trim() && parts.value.length === 0) continue;
    messages.push({
      role: m.role,
      content: m.content,
      parts: parts.value.length ? parts.value : undefined,
    });
  }

  if (messages.length === 0) return { ok: false, response: fail(400, "No messages were sent.") };

  const query = typeof body.query === "string" ? body.query.slice(0, 2000) : "";
  return { ok: true, body: { model: model.id, messages, query } };
}

type PartsResult = { ok: true; value: WirePart[] } | { ok: false; response: NextResponse };

/**
 * Validates the multimodal parts of one message. Only the newest turn is
 * actually being asked about, so attachments on older turns are dropped for
 * models that cannot read them rather than failing the whole conversation.
 */
function readParts(raw: unknown, model: ModelInfo, isLatest: boolean): PartsResult {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, response: fail(400, "Malformed message parts.") };
  if (raw.length > MAX_PARTS) {
    return { ok: false, response: fail(413, `At most ${MAX_PARTS} attachments per message.`) };
  }

  const out: WirePart[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, response: fail(400, "Malformed message part.") };
    }
    const part = entry as Record<string, unknown>;

    if (part.type === "text") {
      if (typeof part.text !== "string" || part.text.length > MAX_CHARS_PER_MESSAGE) {
        return { ok: false, response: fail(413, "An attachment note is too long.") };
      }
      if (part.text.trim()) out.push({ type: "text", text: part.text });
      continue;
    }

    if (part.type === "image_url") {
      const url = (part.image_url as { url?: unknown } | undefined)?.url;
      if (typeof url !== "string" || url.length > MAX_PART_CHARS) {
        return { ok: false, response: fail(413, "That image is too large.") };
      }
      if (!/^data:image\/(png|jpeg|webp|gif|bmp|avif|heic|heif);base64,[A-Za-z0-9+/=]+$/.test(url)) {
        return { ok: false, response: fail(400, "Images must be base64 data URLs.") };
      }
      if (!model.vision) {
        if (isLatest) {
          return { ok: false, response: fail(400, `${model.label} cannot read images.`) };
        }
        continue;
      }
      out.push({ type: "image_url", image_url: { url } });
      continue;
    }

    if (part.type === "input_audio") {
      const audio = part.input_audio as { data?: unknown; format?: unknown } | undefined;
      const data = typeof audio?.data === "string" ? audio.data : "";
      const format = typeof audio?.format === "string" ? audio.format : "";
      if (!data || data.length > MAX_PART_CHARS) {
        return { ok: false, response: fail(413, "That audio clip is too large.") };
      }
      if (!/^[A-Za-z0-9+/=]+$/.test(data)) {
        return { ok: false, response: fail(400, "Audio must be base64 without a data URL prefix.") };
      }
      if (!/^[a-z0-9]{2,5}$/i.test(format)) {
        return { ok: false, response: fail(400, "Audio format is missing.") };
      }
      if (!model.audio) {
        if (isLatest) {
          return { ok: false, response: fail(400, `${model.label} cannot listen to audio.`) };
        }
        continue;
      }
      out.push({ type: "input_audio", input_audio: { data, format: format.toLowerCase() } });
      continue;
    }

    return { ok: false, response: fail(400, "Unsupported attachment type.") };
  }

  return { ok: true, value: out };
}

function fail(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
