"use client";

import { useMemo, useState } from "react";
import type { ConversationSummary } from "@/lib/store";
import { clearAll, storedBytes } from "@/lib/store";
import { BRAND } from "@/lib/brand";
import { formatBytes } from "@/lib/attachment";
import { ThemeToggle } from "./ThemeToggle";
import { FolioMark, LockIcon, PlusIcon, SearchIcon, TrashIcon, XIcon } from "./icons";

export function Sidebar({
  conversations,
  activeId,
  open,
  onClose,
  onNew,
  onSelect,
  onDelete,
  onClearAll,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}) {
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [used, setUsed] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, query]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className={`fixed inset-0 z-30 bg-black/40 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[16.5rem] flex-col bg-ink-050 transition-transform duration-300 ease-out md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center gap-2 px-3">
          <FolioMark className="h-5 w-5 text-ink-900" />
          <span className="text-[0.9375rem] font-semibold tracking-tight text-ink-900">
            {BRAND.wordmark}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sidebar"
            className="icon-button ml-auto md:hidden"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="px-3">
          <button
            type="button"
            onClick={onNew}
            className="flex w-full items-center gap-2 rounded-full border border-stroke bg-ink-100 px-3.5 py-2 text-[0.8125rem] font-medium text-ink-900 shadow-sm transition-colors hover:bg-ink-150"
          >
            <PlusIcon className="h-4 w-4" />
            New chat
          </button>

          {conversations.length > 0 && (
            <div className="relative mt-2">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats"
                aria-label="Search chats"
                className="w-full rounded-full border border-transparent bg-ink-150 py-1.5 pr-3 pl-8 text-[0.8125rem] text-ink-900 outline-none transition-colors placeholder:text-ink-500 hover:bg-ink-200 focus:border-ink-400"
              />
            </div>
          )}
        </div>

        <nav className="mt-3 flex-1 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 ? (
            <p className="px-2 py-3 text-[0.75rem] leading-relaxed text-ink-500">
              Nothing saved yet. Chats live in this browser only.
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-3 text-[0.75rem] text-ink-500">No chats match “{query}”.</p>
          ) : (
            filtered.map((c) => (
              <div
                key={c.id}
                className={`group relative mb-0.5 flex items-center rounded-lg transition-colors ${
                  c.id === activeId ? "bg-ink-200" : "hover:bg-ink-150"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-[0.8125rem] text-ink-800"
                >
                  {c.title}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(c.id)}
                  aria-label={`Delete ${c.title}`}
                  className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-ink-250 hover:text-danger focus-visible:opacity-100"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </nav>

        <div className="p-2.5">
          <div className="mb-2 flex items-start gap-2 px-1.5">
            <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-500" />
            <p className="text-[0.6875rem] leading-relaxed text-ink-500">
              No account, nothing on a server. Chats stay in this browser, and images lose their
              metadata before they are sent.
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-lg px-1 py-0.5">
            <ThemeToggle className="icon-button" />
            {conversations.length > 0 && (
              <div className="ml-auto">
                {confirming ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        clearAll();
                        setConfirming(false);
                        setUsed(0);
                        onClearAll();
                      }}
                      className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[0.6875rem] text-danger transition-colors hover:bg-danger/20"
                    >
                      Delete all
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className="rounded-md px-1.5 py-1 text-[0.6875rem] text-ink-500 transition-colors hover:text-ink-900"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onMouseEnter={() => setUsed(storedBytes())}
                    onFocus={() => setUsed(storedBytes())}
                    onClick={() => setConfirming(true)}
                    className="rounded-md px-2 py-1 text-[0.6875rem] text-ink-500 transition-colors hover:bg-ink-200 hover:text-danger"
                  >
                    Clear local data
                    {used > 0 ? ` (${formatBytes(used)})` : ""}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
