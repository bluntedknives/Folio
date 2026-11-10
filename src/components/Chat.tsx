"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Attachment, ChatMessage, Conversation } from "@/lib/types";
import { getModel, routeModel, workingLabel } from "@/lib/models";
import { ChatError, streamChat } from "@/lib/api";
import {
  deleteConversation as removeConversation,
  deriveTitle,
  emptyConversation,
  listConversations,
  newId,
  readConversation,
  ready as storeReady,
  writeConversation,
  type ConversationSummary,
} from "@/lib/store";
import { conversationToMarkdown, downloadText, safeFilename } from "@/lib/export";
import { Sidebar } from "./Sidebar";
import { MessageBubble } from "./Message";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { Plotter } from "./Plotter";
import { StudyMode } from "./StudyMode";
import {
  ArrowDownIcon,
  DownloadIcon,
  PanelIcon,
  PlusIcon,
  ScreenIcon,
  SpinnerIcon,
} from "./icons";

/** True when the most recent user turn carried anything the model must read. */
function lastTurnWasMultimodal(messages: ChatMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return (messages[i].attachments ?? []).length > 0;
  }
  return false;
}

export function Chat() {
  const [hydrated, setHydrated] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [plotterOpen, setPlotterOpen] = useState(false);
  const [studyOpen, setStudyOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [working, setWorking] = useState<string>("Thinking");
  const [pinned, setPinned] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const latest = useRef<Conversation | null>(null);

  // Open the most recent chat once the store has hydrated. The model is chosen
  // per message, so there is nothing else to restore.
  useEffect(() => {
    let cancelled = false;
    void storeReady().then(() => {
      if (cancelled) return;
      const list = listConversations();
      setSummaries(list);
      const mostRecent = list[0] ? readConversation(list[0].id) : null;
      setConversation(mostRecent ?? emptyConversation());
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced persistence: a stream changes the conversation on every token,
  // and re-encoding the whole record (images included) each time would stutter.
  useEffect(() => {
    if (!hydrated || !conversation) return;
    latest.current = conversation;
    const timer = window.setTimeout(() => {
      writeConversation(conversation);
      setSummaries(listConversations());
    }, 400);
    return () => window.clearTimeout(timer);
  }, [conversation, hydrated]);

  // Flush the pending write if the tab closes mid-stream.
  useEffect(() => {
    const flush = () => {
      if (latest.current) writeConversation(latest.current);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const messages = useMemo(() => conversation?.messages ?? [], [conversation]);

  // Keep the view pinned to the bottom while a reply streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    pinnedRef.current = atBottom;
    setPinned(atBottom);
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    pinnedRef.current = true;
    setPinned(true);
  }

  /**
   * Runs one assistant turn against `history` and streams it into the message
   * with id `assistantId`. Shared by send and regenerate.
   */
  const runTurn = useCallback(
    async (
      history: ChatMessage[],
      assistantId: string,
      model: string,
      label: string,
      query: string,
    ) => {
      setWorking(label);
      setStreaming(true);
      pinnedRef.current = true;
      setPinned(true);
      const controller = new AbortController();
      abortRef.current = controller;

      // Patches only the assistant turn by id, so switching chats mid-stream
      // cannot leak tokens into another conversation.
      const patch = (update: (m: ChatMessage) => ChatMessage) => {
        setConversation((current) => {
          if (!current) return current;
          return {
            ...current,
            updatedAt: Date.now(),
            messages: current.messages.map((m) => (m.id === assistantId ? update(m) : m)),
          };
        });
      };

      let answered = false;
      try {
        await streamChat(model, history, query, controller.signal, {
          onReasoning: (delta: string) =>
            patch((m) => ({ ...m, reasoning: (m.reasoning ?? "") + delta })),
          onContent: (delta: string) => {
            if (delta) answered = true;
            patch((m) => ({ ...m, content: m.content + delta }));
          },
          onSources: (sources) => {
            if (sources.length) patch((m) => ({ ...m, sources }));
          },
          onDone: () => {},
        });
        // A reasoning model can spend its whole budget on chain-of-thought and
        // stop before the answer starts. Surface that instead of an empty bubble.
        if (!answered) {
          patch((m) => ({
            ...m,
            error:
              "The model used up its budget thinking and never answered. Try again, or switch to a non-reasoning model.",
          }));
        }
      } catch (err) {
        if (controller.signal.aborted) {
          patch((m) => (m.content.trim() ? m : { ...m, error: "Stopped." }));
        } else {
          patch((m) => ({
            ...m,
            error: err instanceof ChatError ? err.message : "Something went wrong. Try again.",
          }));
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [],
  );

  const send = useCallback(
    async (text: string, attachments: Attachment[]) => {
      if (!conversation) return;

      // A follow-up question about a photo still needs the photo, so keep the
      // vision model in play for the turn after one too.
      const hasImages = attachments.length > 0 || lastTurnWasMultimodal(conversation.messages);
      const model = routeModel({ hasImages, hasAudio: attachments.some((a) => a.kind === "audio"), prompt: text });
      const label = workingLabel({ hasImages, hasAudio: attachments.some((a) => a.kind === "audio"), prompt: text });

      const userMessage: ChatMessage = {
        id: newId(),
        role: "user",
        content: text,
        attachments: attachments.length ? attachments : undefined,
        createdAt: Date.now(),
      };
      const assistantId = newId();
      const history = [...conversation.messages, userMessage];

      setConversation({
        ...conversation,
        title: deriveTitle(history),
        messages: [
          ...history,
          {
            id: assistantId,
            role: "assistant",
            content: "",
            createdAt: Date.now(),
            model,
          },
        ],
        updatedAt: Date.now(),
      });

      await runTurn(history, assistantId, model, label, text);
    },
    [conversation, runTurn],
  );

  /** Re-asks the last user turn, replacing the assistant reply below it. */
  const regenerate = useCallback(async () => {
    if (!conversation || streaming) return;
    const msgs = conversation.messages;

    let lastUser = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        lastUser = i;
        break;
      }
    }
    if (lastUser === -1) return;

    const prompt = msgs[lastUser].content;
    const lastAttachments = msgs[lastUser].attachments ?? [];
    const hasImages = lastAttachments.length > 0;
    const hasAudio = lastAttachments.some((a) => a.kind === "audio");
    const model = routeModel({ hasImages, hasAudio, prompt });
    const label = workingLabel({ hasImages, hasAudio, prompt });

    const history = msgs.slice(0, lastUser + 1);
    const assistantId = newId();
    setConversation({
      ...conversation,
      messages: [
        ...history,
        { id: assistantId, role: "assistant", content: "", createdAt: Date.now(), model },
      ],
      updatedAt: Date.now(),
    });

    await runTurn(history, assistantId, model, label, prompt);
  }, [conversation, runTurn, streaming]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const startNew = useCallback(() => {
    abortRef.current?.abort();
    setConversation(emptyConversation());
    setSidebarOpen(false);
  }, []);

  const select = useCallback((id: string) => {
    abortRef.current?.abort();
    const conv = readConversation(id);
    if (conv) setConversation(conv);
    setSidebarOpen(false);
  }, []);

  const remove = useCallback((id: string) => {
    removeConversation(id);
    setSummaries(listConversations());
    setConversation((current) => (current?.id === id ? emptyConversation() : current));
  }, []);

  const clearEverything = useCallback(() => {
    abortRef.current?.abort();
    setSummaries(listConversations());
    setConversation(emptyConversation());
  }, []);

  const exportChat = useCallback(() => {
    if (!conversation) return;
    downloadText(safeFilename(conversation.title), conversationToMarkdown(conversation));
  }, [conversation]);

  const activeModel = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.model);
    return lastAssistant?.model ? getModel(lastAssistant.model) : undefined;
  }, [messages]);

  const canExport = messages.some((m) => m.content.trim());
  const canRegenerate = !streaming && messages.some((m) => m.role === "user");

  return (
    <div className="flex h-dvh overflow-hidden bg-ink-100">
      <Sidebar
        conversations={summaries}
        activeId={conversation?.id ?? null}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNew={startNew}
        onSelect={select}
        onDelete={remove}
        onClearAll={clearEverything}
      />

      <Plotter
        open={plotterOpen}
        onClose={() => setPlotterOpen(false)}
        onAsk={(text) => void send(text, [])}
      />

      <StudyMode open={studyOpen} onClose={() => setStudyOpen(false)} />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1.5 px-3 sm:px-5">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
            className="icon-button md:hidden"
          >
            <PanelIcon className="h-4 w-4" />
          </button>
          <h1 className="truncate text-[0.9375rem] font-medium text-ink-900">
            {conversation?.title ?? "New chat"}
          </h1>
          <span
            aria-live="polite"
            className="ml-auto hidden items-center gap-1.5 text-[0.6875rem] text-ink-500 sm:flex"
          >
            {streaming ? (
              <>
                <SpinnerIcon className="spin h-3 w-3 text-accent" />
                {working}
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-ok" />
                {activeModel ? `${activeModel.label} · auto` : "Ready"}
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => setStudyOpen(true)}
            aria-label="Open study mode"
            title="Study mode: share your screen"
            className="icon-button"
          >
            <ScreenIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={exportChat}
            disabled={!canExport}
            aria-label="Export chat as Markdown"
            title="Export as Markdown"
            className="icon-button disabled:opacity-30"
          >
            <DownloadIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={startNew}
            aria-label="New chat"
            className="icon-button md:hidden"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </header>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="relative flex-1 overflow-y-auto overscroll-contain"
        >
          {messages.length === 0 ? (
            <EmptyState
              onPick={(text) => void send(text, [])}
              onOpenPlotter={() => setPlotterOpen(true)}
            />
          ) : (
            <div className="mx-auto max-w-3xl py-6">
              {messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  streaming={streaming && i === messages.length - 1}
                  workingLabel={streaming && i === messages.length - 1 ? working : undefined}
                  onRegenerate={
                    canRegenerate && i === messages.length - 1
                      ? () => void regenerate()
                      : undefined
                  }
                />
              ))}
            </div>
          )}

          {!pinned && (
            <button
              type="button"
              onClick={scrollToBottom}
              aria-label="Scroll to latest"
              className="fade sticky bottom-4 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-stroke-strong bg-ink-200/90 text-ink-700 shadow-lg backdrop-blur transition-colors hover:text-ink-900"
            >
              <ArrowDownIcon className="h-4 w-4" />
            </button>
          )}
        </div>

        <Composer
          disabled={!hydrated || streaming}
          streaming={streaming}
          onSend={send}
          onStop={stop}
          onOpenPlotter={() => setPlotterOpen(true)}
        />
      </main>
    </div>
  );
}
