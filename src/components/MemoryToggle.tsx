"use client";

import { useCallback, useSyncExternalStore } from "react";
import { MemoryIcon } from "./icons";
import { MEMORY_KEY, memoryEnabled, setMemoryEnabled } from "@/lib/memory";

/**
 * Whether earlier chats are recalled in new ones.
 *
 * localStorage is the source of truth, read through `useSyncExternalStore` so
 * the button matches storage without an effect that would set state on mount.
 * The change event only fires in other tabs, so this component dispatches its
 * own after writing; that is what keeps every open tab in step.
 */
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("folio::memory-change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("folio::memory-change", onChange);
  };
}

const getSnapshot = () => memoryEnabled();
const getServerSnapshot = () => true;

export function MemoryToggle({ className }: { className?: string }) {
  const on = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    setMemoryEnabled(!memoryEnabled());
    window.dispatchEvent(new Event("folio::memory-change"));
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Stop recalling earlier chats" : "Recall earlier chats"}
      title={
        on
          ? "Recalling earlier chats. Click to stop."
          : "Not recalling earlier chats. Click to turn on."
      }
      className={className ?? "icon-button"}
      data-memory={on ? "on" : "off"}
    >
      <MemoryIcon className="h-4 w-4" />
    </button>
  );
}

export { MEMORY_KEY };
