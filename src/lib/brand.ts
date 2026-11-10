/**
 * Single source of truth for the product name and storage namespace.
 * Everything user-visible or persisted reads from here.
 */

export const BRAND = {
  name: "Folio",
  wordmark: "folio",
  tagline: "Homework, worked out.",
  description:
    "A homework helper for any assignment. Worked solutions, proper maths, live graphs. No account, and nothing is stored on a server.",
} as const;

/** Current localStorage namespace. */
export const STORE_NS = "folio";

/** Namespaces this app has used before, read once so history survives a rename. */
export const LEGACY_STORE_NS = ["ch4lk"] as const;
