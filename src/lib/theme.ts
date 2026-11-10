/** localStorage key holding the chosen theme. */
export const THEME_KEY = "folio::theme";

/** Applied to <html> briefly during a manual toggle so colours cross-fade. */
export const THEME_ANIM_CLASS = "theme-anim";

/**
 * Runs before first paint to set `dark` on <html>, so the page never flashes
 * the wrong theme. Kept as a string because it has to be inlined into the
 * document head and executed synchronously.
 */
export const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)});var d=s?s==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;
