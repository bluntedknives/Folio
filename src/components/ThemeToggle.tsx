"use client";

import { useCallback, useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "./icons";
import { THEME_ANIM_CLASS, THEME_KEY } from "@/lib/theme";

/**
 * The `dark` class on <html> is the source of truth: a blocking script in the
 * layout sets it before paint, and the toggle flips it. This subscribes to
 * that class so the icon always matches the DOM without local state.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

const getSnapshot = () => document.documentElement.classList.contains("dark");
const getServerSnapshot = () => false;

export function ThemeToggle({ className }: { className?: string }) {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const root = document.documentElement;
    const next = !root.classList.contains("dark");
    // Add the fade class for one frame, then remove it so the !important
    // transition never fights component hover effects afterwards.
    root.classList.add(THEME_ANIM_CLASS);
    root.classList.toggle("dark", next);
    window.setTimeout(() => root.classList.remove(THEME_ANIM_CLASS), 240);
    try {
      window.localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      /* private mode: the choice just will not persist */
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      className={className ?? "icon-button"}
    >
      {dark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </button>
  );
}
