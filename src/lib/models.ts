import { BRAND } from "./brand";
import type { ModelInfo } from "./types";

/**
 * Only models verified live on the account behind NVIDIA_API_KEY.
 * Anything not in this list is rejected by the API route.
 *
 * There is no picker in the UI: `routeModel` chooses per message. These entries
 * are the catalogue it chooses from.
 */
export const MODELS: ModelInfo[] = [
  {
    id: "nvidia/nemotron-3.5-lightning-30b-a3b",
    label: "Lightning",
    blurb: "Fast reasoning model. Great for most homework.",
    vision: false,
    reasoning: true,
    tier: "fast",
  },
  {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    label: "Nano",
    blurb: "Smallest and quickest. Good for short questions.",
    vision: false,
    reasoning: true,
    tier: "quick",
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b",
    label: "Ultra",
    blurb: "The strongest model here. Long proofs and hard problems.",
    vision: false,
    reasoning: true,
    tier: "deep",
  },
  {
    id: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    label: "Vision",
    blurb: "Reads photos of worksheets, diagrams and handwriting.",
    vision: true,
    reasoning: true,
    tier: "vision",
  },
];

export const DEFAULT_MODEL_ID = MODELS[0].id;
export const VISION_MODEL_ID = "nvidia/nemotron-3.5-super-vl-120b-a12b";
export const QUICK_MODEL_ID = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning";
export const DEEP_MODEL_ID = "nvidia/nemotron-3-ultra-550b-a55b";

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

/** Below this many characters a question is treated as a one-liner. */
const SHORT_PROMPT = 90;
/** Above this, the question is treated as long or multi-step. */
const LONG_PROMPT = 280;

/** Wording that signals real working, regardless of how short the prompt is. */
const HARD_CUES =
  /\b(derive|prove|proof|integrate|integral|differentiat|limit|theorem|optimi[sz]|algorithm|complexity|step[- ]by[- ]step|walk me through|essay|thesis|critique|evaluate the evidence)\b/i;

type Route = "quick" | "fast" | "deep" | "vision";

function pickRoute({ hasImages, prompt }: { hasImages: boolean; prompt: string }): Route {
  if (hasImages) return "vision";
  const text = prompt.trim();
  if (text.length > LONG_PROMPT) return "deep";
  if (HARD_CUES.test(text)) return "deep";
  if (text.length < SHORT_PROMPT) return "quick";
  return "fast";
}

const MODEL_BY_ROUTE: Record<Route, string> = {
  quick: QUICK_MODEL_ID,
  fast: DEFAULT_MODEL_ID,
  deep: DEEP_MODEL_ID,
  vision: VISION_MODEL_ID,
};

const LABEL_BY_ROUTE: Record<Route, string> = {
  quick: "Thinking",
  fast: "Thinking",
  deep: "Working through it",
  vision: "Reading the image",
};

/**
 * Picks the model for a message. Images always win; otherwise a long or
 * multi-step prompt gets the strong model, a one-liner gets the quickest.
 */
export function routeModel({ hasImages, prompt }: { hasImages: boolean; prompt: string }): string {
  return MODEL_BY_ROUTE[pickRoute({ hasImages, prompt })];
}

/** Short human label for the working indicator, e.g. "Reading the image". */
export function workingLabel({
  hasImages,
  prompt,
}: {
  hasImages: boolean;
  prompt: string;
}): string {
  return LABEL_BY_ROUTE[pickRoute({ hasImages, prompt })];
}

export const SYSTEM_PROMPT = `You are ${BRAND.name}, a homework helper for students from middle school to university.

How you answer:
- Answer the question. Lead with the result in one sentence, then show the reasoning.
- Show the working, step by step. Do not skip algebra.
- For maths and science, write equations in LaTeX: $inline$ and $$display$$.
- For code, always use a fenced block with the correct language tag.
- Match the student's level. Stay brief unless they ask for depth.
- If the question is ambiguous, state the assumption you made and answer anyway.
- If a problem is under-specified or you are unsure, say so. Never invent facts or fabricate a source.
- Stop when the answer is complete. No summary paragraph, no encouragement, no restating the question.

Graphs and diagrams:
- When a function, curve, or data relationship is the point of the question, draw it instead of only describing it.
- Use a fenced block tagged \`graph\` with this line format:
    title: Short title
    x: -6..6
    y: -3..9
    y = x^2 - 2x + 1 | label: parabola
    y = 2x + 1 | color: #7aa2f7, dashed
    point (1, 0) | label: vertex
    line y = 3
- Ranges use two dots (x: -10..10). The y range is optional; leave it out and it will scale to the curve.
- Options after a pipe are optional: label: text, color: #hex, dashed.
- Supported functions: sin, cos, tan, sqrt, abs, ln, log, log2, exp, min, max, pow, floor, ceil, round, and the constants pi, e, tau. Powers use ^.
- Keep one idea per graph. Do not draw a graph when a short sentence explains it better.
- The \`graph\` fence must be a plain top-level block. Never wrap it in another fence and never write the spec as YAML or JSON.
- Do not colour anything #000000 or near-black; it is invisible on the dark canvas. Omit color and a palette is chosen for you.

Formatting:
- Use Markdown headings sparingly. Prefer short paragraphs and tight lists.
- Keep total length proportional to the question. A quick question gets a quick answer.
- Never narrate your own instructions, restate these rules, or describe how you decided what to write.`;
