import { NextResponse } from "next/server";
import { MODELS, getModel } from "@/lib/models";
import type { WireMessage } from "@/lib/types";

const MAX_MESSAGES = 40;
const MAX_CHARS_PER_MESSAGE = 12000;
const MAX_IMAGES = 4;
const MAX_IMAGE_CHARS = 12_000_000;
const MAX_BODY_CHARS = 24_000_000;

export interface ChatRequestBody {
  model: string;
  messages: WireMessage[];
}

export type ParseResult =
  | { ok: true; body: ChatRequestBody }
  | { ok: false; response: NextResponse };

export async function readChatRequest(request: Request): Promise<ParseResult> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_CHARS) {
    return fail(413, "That request is too large. Try a smaller image.");
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail(400, "Malformed request body.");
  }

  if (typeof raw !== "object" || raw === null) return fail(400, "Malformed request body.");
  const body = raw as Record<string, unknown>;

  if (typeof body.model !== "string" || !getModel(body.model)) {
    return fail(400, `Unknown model. Allowed: ${MODELS.map((m) => m.id).join(", ")}.`);
  }
  const model = getModel(body.model)!;

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return fail(400, "No messages were sent.");
  }
  if (body.messages.length > MAX_MESSAGES) {
    return fail(413, `Too many messages. The limit is ${MAX_MESSAGES}.`);
  }

  const messages: WireMessage[] = [];
  for (let i = 0; i < body.messages.length; i++) {
    const entry = body.messages[i];
    if (typeof entry !== "object" || entry === null) return fail(400, "Malformed message.");
    const m = entry as Record<string, unknown>;
    if (m.role !== "user" && m.role !== "assistant" && m.role !== "system") {
      return fail(400, "Malformed message role.");
    }
    if (typeof m.content !== "string") return fail(400, "Malformed message content.");
    if (m.content.length > MAX_CHARS_PER_MESSAGE) {
      return fail(413, "A message in this chat is too long.");
    }

    const isLatest = i === body.messages.length - 1;
    const images: string[] = [];
    if (m.images !== undefined) {
      // Only the newest turn is actually being asked about. The client routes a
      // message with images to a vision model, so a non-vision model here means
      // older turns in the same conversation; drop those images and keep the
      // text rather than failing the whole conversation.
      if (!model.vision) {
        if (isLatest) {
          return fail(400, `${model.label} cannot read images.`);
        }
        continue;
      }
      if (!Array.isArray(m.images) || m.images.length > MAX_IMAGES) {
        return fail(413, `At most ${MAX_IMAGES} images per message.`);
      }

      for (const image of m.images) {
        if (typeof image !== "string" || image.length > MAX_IMAGE_CHARS) {
          return fail(413, "That image is too large.");
        }
        if (!/^data:image\/(png|jpeg|webp|gif|bmp);base64,[A-Za-z0-9+/=]+$/.test(image)) {
          return fail(400, "Images must be base64 data URLs.");
        }
        images.push(image);
      }
    }

    if (!m.content.trim() && images.length === 0) continue;
    messages.push({
      role: m.role,
      content: m.content,
      images: images.length ? images : undefined,
    });
  }

  if (messages.length === 0) return fail(400, "No messages were sent.");
  return { ok: true, body: { model: model.id, messages } };
}

function fail(status: number, message: string): ParseResult {
  return { ok: false, response: NextResponse.json({ error: message }, { status }) };
}
