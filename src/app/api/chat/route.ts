import { readChatRequest } from "@/lib/validation";
import { SYSTEM_PROMPT } from "@/lib/models";
import { formatSources, search, shouldSearch } from "@/lib/search";
import type { Source, WireMessage } from "@/lib/types";

export const maxDuration = 120;

const UPSTREAM_TIMEOUT_MS = 115_000;

export async function POST(request: Request) {
  const parsed = await readChatRequest(request);
  if (!parsed.ok) return parsed.response;

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Server is missing NVIDIA_API_KEY. Add it to .env.local and restart." },
      { status: 500 },
    );
  }

  // Search runs on the server, before the model call, so the results can be
  // folded into the system prompt. A failure here just means no web context.
  let sources: Source[] = [];
  if (parsed.body.query && shouldSearch(parsed.body.query)) {
    sources = await search(parsed.body.query);
  }
  const systemPrompt = sources.length
    ? `${SYSTEM_PROMPT}\n\n${formatSources(sources)}`
    : SYSTEM_PROMPT;

  const baseUrl = (process.env.NVIDIA_BASE_URL ?? "https://integrate.api.nvidia.com/v1").replace(
    /\/+$/,
    "",
  );

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: parsed.body.model,
      messages: [{ role: "system", content: systemPrompt }, ...toUpstream(parsed.body.messages)],
      stream: true,
      temperature: 0.6,
      top_p: 0.95,
      // Reasoning models spend most of the budget on chain-of-thought before
      // the answer starts, so the ceiling has to cover both.
      max_tokens: 16384,
    }),
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
  });

  if (!upstream.ok || !upstream.body) {
    return upstreamError(upstream.status, await safeText(upstream));
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      // The client reads this to show where the answer came from.
      "X-Folio-Sources": encodeURIComponent(JSON.stringify(sources)),
    },
  });
}

/**
 * Expands our wire format into the OpenAI-style content parts NVIDIA expects.
 * A message with parts becomes an array; one without stays a plain string.
 */
function toUpstream(messages: WireMessage[]) {
  return messages.map((m) => {
    if (!m.parts?.length) return { role: m.role, content: m.content };
    const parts = [...m.parts];
    // The user's own words always ride along, even when the attachment notes
    // added their own text part. Dropping them here left the model looking at
    // an image with no question.
    if (m.content.trim()) {
      parts.unshift({ type: "text", text: m.content });
    } else if (!parts.some((p) => p.type === "text")) {
      parts.unshift({ type: "text", text: "Read this and help me with the assignment." });
    }
    return { role: m.role, content: parts };
  });
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function upstreamError(status: number, body: string): Response {
  const detail = extractDetail(body);
  const friendly =
    status === 401 || status === 403
      ? "The NVIDIA API key was rejected. Check NVIDIA_API_KEY in .env.local."
      : status === 404
        ? "That model is not available on this account. Pick another model."
        : status === 429
          ? "Rate limited by NVIDIA. Wait a moment and try again."
          : status >= 500
            ? "NVIDIA returned a server error. Try again in a moment."
            : detail || "The model request failed.";

  return Response.json({ error: friendly, upstream: detail || undefined }, { status });
}

function extractDetail(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; error?: unknown; message?: unknown };
    for (const value of [parsed.detail, parsed.error, parsed.message]) {
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 300);
    }
  } catch {
    /* not JSON */
  }
  return body.slice(0, 300);
}
