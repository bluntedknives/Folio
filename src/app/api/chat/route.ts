import { readChatRequest } from "@/lib/validation";
import { SYSTEM_PROMPT, getModel, routeFor, thinkingFor } from "@/lib/models";
import { formatSources, search, shouldSearch } from "@/lib/search";
import { formatUnreadableVideo, formatVideo, loadVideo } from "@/lib/youtube-server";
import { formatPages, loadPages } from "@/lib/page-server";
import { latestVideoId } from "@/lib/youtube";
import { latestWebLinks } from "@/lib/urls";
import type { Source, WireMessage, WirePart } from "@/lib/types";

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

  // A video in the conversation is re-read here rather than stored with the
  // chat, so the prompt always carries the current title and description.
  const videoId = parsed.body.videoId ?? latestVideoId(parsed.body.messages);
  const video = videoId ? await loadVideo(videoId) : null;

  // Any other web link in the conversation is fetched and its readable text is
  // folded into the prompt, so a question about a page is answered from the
  // page rather than from memory. The links are read from the messages rather
  // than from the client, so the same validation applies to both.
  const links = videoId
    ? []
    : latestWebLinks(parsed.body.messages.map((m) => ({ role: m.role, content: m.content })));
  const pages = links.length ? await loadPages(links.map((l) => l.url)) : [];

  // Search runs on the server, before the model call, so the results can be
  // folded into the system prompt. A failure here just means no web context.
  // A video question is answered from the video, so search is skipped: the
  // question is usually "what is this" and the open web has nothing to add.
  // A linked page is skipped for the same reason: its own text is the source.
  let sources: Source[] = [];
  if (!videoId && pages.length === 0 && parsed.body.query && shouldSearch(parsed.body.query)) {
    sources = await search(parsed.body.query);
  }

  // A linked video that could not be read still has to be acknowledged, or the
  // model answers as if no video were mentioned.
  const videoBlock = video
    ? formatVideo(video)
    : videoId
      ? formatUnreadableVideo(videoId)
      : "";

  // The same for a page: a link that could not be fetched is still a link the
  // student gave, and the model must not answer as if nothing were attached.
  const pageBlock = pages.length
    ? formatPages(pages)
    : links.length
      ? `A web page was linked but could not be read: ${links.map((l) => l.url).join(", ")}. Say in one short line that you could not read it, and offer to help if the student pastes the text.`
      : "";

  const extras = [
    sources.length ? formatSources(sources) : "",
    videoBlock,
    pageBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
  const systemPrompt = extras ? `${SYSTEM_PROMPT}\n\n${extras}` : SYSTEM_PROMPT;

  // Frames are attached to the newest turn, which is what the model is being
  // asked about. Older turns keep only their text.
  const messages = toUpstream(parsed.body.messages, video?.frames ?? []);

  // A video carries images, and only the multimodal model can see them. The
  // route was chosen from the text alone, so it is corrected here rather than
  // sending an image part to a model that will reject the whole request.
  const decision = routeFor({
    hasImages: parsed.body.hasImages || (video?.frames.length ?? 0) > 0,
    hasAudio: parsed.body.hasAudio,
    prompt: parsed.body.query,
  });
  const routed = getModel(parsed.body.model);
  const canSee = (routed?.vision ?? false) || (video?.frames.length ?? 0) === 0;
  const model = canSee ? parsed.body.model : decision.model;

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
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      stream: true,
      temperature: 0.6,
      top_p: 0.95,
      // Reasoning models spend most of the budget on chain-of-thought before
      // the answer starts, so the ceiling has to cover both.
      max_tokens: 16384,
      // Off for everything but the deep route: it is the single biggest saving
      // in time-to-first-token, and short homework does not need it.
      chat_template_kwargs: { enable_thinking: thinkingFor(model) },
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
 *
 * `frames` are appended to the last user turn only: they are what the question
 * is about, and repeating them on every turn would multiply the prompt size
 * for no gain.
 */
function toUpstream(messages: WireMessage[], frames: string[]) {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUser = i;
      break;
    }
  }

  return messages.map((m, i) => {
    const parts: WirePart[] = [...(m.parts ?? [])];
    if (frames.length && i === lastUser) {
      for (const url of frames) parts.push({ type: "image_url", image_url: { url } });
    }

    if (!parts.length) return { role: m.role, content: m.content };

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
