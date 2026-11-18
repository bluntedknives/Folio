/**
 * Deck requests, and the topic a deck gets when the student does not name one.
 *
 * Asking the model to invent a topic works most of the time, but not all of the
 * time: a bare "make a deck" occasionally comes back as "what topic would you
 * like?", which is the one answer a deck request must never get. The topic is
 * therefore filled in here, on the way to the model, so a request always leaves
 * the server with something to build. It is deliberately a light touch — a
 * topic is only added when the student has not named one, and it is added to
 * the prompt rather than shown as a message, so the chat still reads as theirs.
 */

/** The nouns that mean "make me a deck". */
const DECK_NOUN =
  /\b(?:slides|slide|slideshow|slide\s?deck|deck|presentation|presentation\s?deck|powerpoint|ppt|pptx)\b/i;

/** The verbs that mean "make me one", as opposed to "explain this deck". */
const DECK_VERB =
  /\b(?:make|create|generate|build|prepare|do|give|write|put\s+together|design|random|any)\b/i;

/**
 * Words that carry no topic: the request itself and its filler. A query that
 * is nothing but these has no subject of its own, so one is supplied.
 */
const FILLER = new Set([
  "a", "an", "the", "me", "us", "my", "our", "i", "you", "please", "pls", "can", "could", "would",
  "will", "you", "u", "some", "any", "random", "make", "made", "create", "creating", "generate",
  "generating", "genereate", "build", "building", "prepare", "do", "give", "write", "put",
  "together", "design", "slides", "slide", "slideshow", "deck", "presentation", "powerpoint",
  "ppt", "pptx", "google", "gslides", "quick", "quickly", "new", "fresh", "simple", "short",
  "nice", "cool", "small", "about", "on", "for", "of", "to", "in", "with", "and", "it", "one",
  "that", "this", "there", "is", "are", "be", "so", "just", "now", "then", "up", "out", "here",
  "hey", "hi", "hello", "ok", "okay", "sure", "thanks", "thank", "plz", "would", "should",
]);

/**
 * True when the student is asking for a deck to be made.
 *
 * Needs a deck noun and a making verb, so "explain this slide" and "what is a
 * presentation" are left alone — those are questions about decks, not requests
 * for one.
 */
export function isDeckRequest(query: string): boolean {
  const q = query ?? "";
  return DECK_NOUN.test(q) && DECK_VERB.test(q);
}

/**
 * True when the request names its own subject.
 *
 * The request's own scaffolding — the verb, the deck noun, articles and filler
 * — is stripped, and anything left is taken as the topic. One content word is
 * enough, so "make a deck about war" and "slides on mitosis" keep their
 * subject; a request of nothing but filler has none and gets one supplied.
 */
export function hasDeckTopic(query: string): boolean {
  const words = (query ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.some((w) => !FILLER.has(w) && w.length > 1);
}

/**
 * Topics a topic-less request is answered with. Ordinary school subjects, so
 * the deck that comes back is useful revision rather than filler.
 */
export const DECK_TOPICS = [
  "the water cycle",
  "photosynthesis",
  "the solar system",
  "the American civil rights movement",
  "plate tectonics and earthquakes",
  "the human digestive system",
  "climate change and its causes",
  "the French Revolution",
  "how vaccines work",
  "the periodic table and its groups",
  "the carbon cycle",
  "the structure of an atom",
  "the causes of World War I",
  "cell division: mitosis and meiosis",
  "the quadratic formula and how to use it",
  "Newton's three laws of motion",
  "the water and nitrogen cycles compared",
  "the Renaissance and its ideas",
  "how the internet sends data",
  "the immune system and how it defends the body",
];

/**
 * The query to send upstream.
 *
 * A deck request with no subject of its own gets one appended, so the model
 * always has something to build. Anything else is returned untouched, and a
 * request that already names its topic is never second-guessed.
 */
export function withDeckTopic(
  query: string,
  pick: (n: number) => number = (n) => Math.floor(Math.random() * n),
): string {
  const q = query ?? "";
  if (!isDeckRequest(q) || hasDeckTopic(q)) return q;
  const index = Math.min(DECK_TOPICS.length - 1, Math.max(0, pick(DECK_TOPICS.length)));
  return `${q.trim()} about ${DECK_TOPICS[index]}`;
}
