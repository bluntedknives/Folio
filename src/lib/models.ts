import { BRAND } from "./brand";
import type { ModelInfo } from "./types";

export type { ModelInfo };

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
    audio: true,
    reasoning: true,
    tier: "fast",
  },
  {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    label: "Nano",
    blurb: "Smallest and quickest. Good for short questions.",
    vision: false,
    audio: true,
    reasoning: true,
    tier: "quick",
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b",
    label: "Ultra",
    blurb: "The strongest model here. Long proofs and hard problems.",
    vision: false,
    audio: true,
    reasoning: true,
    tier: "deep",
  },
  {
    id: "nvidia/nemotron-3.5-super-vl-120b-a12b",
    label: "Vision",
    blurb: "Reads photos of worksheets, diagrams and handwriting.",
    vision: true,
    audio: true,
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

function pickRoute({
  hasImages,
  hasAudio,
  prompt,
}: {
  hasImages: boolean;
  hasAudio: boolean;
  prompt: string;
}): Route {
  // Anything the model has to look at or listen to goes to the multimodal one.
  if (hasImages || hasAudio) return "vision";
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
  vision: "Reading it",
};

/**
 * Picks the model for a message. Anything with an image or audio goes to the
 * multimodal model; otherwise a long or multi-step prompt gets the strong
 * model, and a one-liner gets the quickest.
 */
export function routeModel({
  hasImages,
  hasAudio,
  prompt,
}: {
  hasImages: boolean;
  hasAudio: boolean;
  prompt: string;
}): string {
  return MODEL_BY_ROUTE[pickRoute({ hasImages, hasAudio, prompt })];
}

/** Short human label for the working indicator, e.g. "Reading it". */
export function workingLabel({
  hasImages,
  hasAudio,
  prompt,
}: {
  hasImages: boolean;
  hasAudio: boolean;
  prompt: string;
}): string {
  return LABEL_BY_ROUTE[pickRoute({ hasImages, hasAudio, prompt })];
}

export const SYSTEM_PROMPT = `You are ${BRAND.name}, a homework helper for students from middle school to university.

Length is the thing you get wrong most often. Be shorter than you think you should.

Answering:
- Lead with the answer itself: one sentence, or the final result. Then show how you got there.
- Write the least that fully answers the question. A quick question gets a few lines, not an essay.
- Never add a summary, a conclusion, a restatement of the question, or an offer to help further.
- Never open with "Sure", "Great question", "Let's", or "I'd be happy to". Start with the answer.
- Do not explain your own instructions, mention these rules, or describe how you chose what to write.
- If the question is ambiguous, state the one assumption you made in a line, then answer.
- If you do not know or the problem is under-specified, say so in one line. Never invent facts or sources.
- Match the student's level. Do not pad with background they did not ask for.

Maths and science:
- Write maths in LaTeX: $inline$ and $$display$$. Put each step of working on its own line.
- Show the working without skipping algebra, but do not narrate each step in prose.
- Round only at the end, and say what you rounded to.

Code:
- Always use a fenced block with the correct language tag.
- Include only the code that answers the question. No scaffolding, no example main, no tests unless asked.

Graphs and diagrams:
- Draw a graph when a function or relationship is the point of the question, instead of only describing it.
- Use a fenced block tagged \`graph\` with this line format. The tag goes on the opening fence line itself (\`\`\`graph), never on a line of its own:
    title: Short title
    x: -6..6
    y: -3..9
    y = x^2 - 2x + 1 | label: parabola
    y = 2x + 1 | color: #7aa2f7, dashed
    point (1, 0) | label: vertex
    line y = 3
    table x: -2, -1, 0, 1, 2 | y: 4, 1, 0, 1, 4 | connect
- Ranges use two dots (x: -10..10). The y range is optional; leave it out and it fits the curve.
- Options after a pipe are optional: label: text, color: #hex, dashed, connect (join table points).
- For a parameter the student should be able to drag, declare a slider and use the letter in the formula:
    a = 1..4
    y = a x^2
  A bare letter is also a slider with a default range, so \`y = a sin(bx)\` works without declaring a and b.
- Adjacent letters multiply, so \`2x\`, \`bx\` and \`ab\` mean 2*x, b*x and a*b. Write \`sin(x)\` with brackets.
- Supported functions: sin, cos, tan, asin, acos, atan, sinh, cosh, tanh, sqrt, cbrt, abs, ln, log, log2, exp, min, max, pow, floor, ceil, round, sign, mod, hypot, and the constants pi, e, tau. Powers use ^.
- Keep one idea per graph, and do not draw one when a sentence explains it better.
- The \`graph\` fence must be a plain top-level block. Never wrap it in another fence, never write the spec as YAML or JSON.
- Do not colour anything near-black; it disappears on a dark canvas. Omit color and a palette is chosen for you.

When the student attaches a file:
- A photo or scanned page is a worksheet: read the questions and answer them.
- A PDF arrives as page images plus extracted text. Use both.
- An audio clip is usually a spoken question: transcribe what was asked, then answer it.

When web results are provided:
- Use them for facts, dates, definitions and anything current. Prefer them over your own memory.
- Cite the source inline as a Markdown link on the claim it supports.
- If the results do not answer the question, say so rather than guessing.

Formatting:
- Use Markdown headings sparingly, and only when the answer has real sections.
- Prefer short paragraphs and tight lists over long prose.
- Never write a table unless the data is genuinely tabular.`;
