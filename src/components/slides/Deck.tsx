"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DECK_THEMES,
  deckOutline,
  effectiveLayout,
  parseDeck,
  toDeckFence,
  type Deck,
  type DeckTheme,
  type Slide,
  type SlideLayout,
} from "@/lib/slides/spec";
import {
  downloadDeckHtml,
  downloadDeckPptx,
  printDeck,
} from "@/lib/slides/export";
import { SlideView } from "./SlideView";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CollapseIcon,
  CopyIcon,
  DownloadIcon,
  ExpandIcon,
  PencilIcon,
  PlayDeckIcon,
  PlusIcon,
  PrinterIcon,
  SlidesIcon,
  TrashIcon,
  XIcon,
} from "../icons";

const LAYOUTS: { id: SlideLayout; label: string }[] = [
  { id: "title", label: "Title" },
  { id: "bullets", label: "Bullets" },
  { id: "section", label: "Section" },
  { id: "quote", label: "Quote" },
  { id: "code", label: "Code" },
  { id: "split", label: "Split" },
];

/**
 * A presentation the model produced, or one the student starts from scratch.
 *
 * This is the deck's home: the same card edits it, presents it, and exports it,
 * so a student never has to leave the chat to finish a slideshow. Editing is a
 * form rather than a contenteditable surface, because a controlled input is the
 * only thing that stays in step with the deck once slides are added or moved.
 */
export function Deck({
  source,
  onAsk,
}: {
  source: string;
  onAsk?: (text: string) => void;
}) {
  const parsed = useMemo(() => parseDeck(source), [source]);
  const [deck, setDeck] = useState<Deck | null>(() => (parsed.ok ? parsed.deck : null));
  const [current, setCurrent] = useState(0);
  const [editing, setEditing] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [copied, setCopied] = useState<"deck" | "outline" | null>(null);

  // Re-seed when the model streams a corrected deck into the same card.
  const sourceKey = parsed.ok ? source : "";
  const [seeded, setSeeded] = useState(sourceKey);
  if (sourceKey && seeded !== sourceKey) {
    setSeeded(sourceKey);
    setDeck(parsed.ok ? parsed.deck : null);
    setCurrent(0);
  }

  if (!parsed.ok || !deck) {
    return (
      <div className="deck-shell">
        <div className="deck-head">
          <SlidesIcon className="h-4 w-4" />
          <span className="deck-title">slides</span>
        </div>
        <p className="deck-error">{parsed.ok ? "That deck could not be read." : parsed.error}</p>
      </div>
    );
  }

  // `deck` is non-null past the guard, but TypeScript drops that narrowing
  // inside the callbacks below, so the narrowed value is captured once.
  const active = deck;
  const slides = active.slides;
  const safeIndex = Math.min(current, slides.length - 1);
  const slide = slides[safeIndex];

  const patch = (update: (draft: Deck) => Deck) => setDeck((prev) => (prev ? update(prev) : prev));
  const patchSlide = (index: number, update: (slide: Slide) => Slide) =>
    patch((d) => ({ ...d, slides: d.slides.map((s, i) => (i === index ? update(s) : s)) }));

  function addSlide() {
    const blank: Slide = {
      title: "New slide",
      subtitle: "",
      layout: "bullets",
      body: [],
      bullets: [],
      ordered: false,
      quote: "",
      code: null,
      image: "",
      notes: "",
    };
    patch((d) => {
      const next = [...d.slides];
      next.splice(safeIndex + 1, 0, blank);
      return { ...d, slides: next };
    });
    setCurrent(safeIndex + 1);
    setEditing(true);
  }

  function duplicateSlide(index: number) {
    patch((d) => {
      const next = [...d.slides];
      next.splice(index + 1, 0, structuredClone(d.slides[index]));
      return { ...d, slides: next };
    });
    setCurrent(index + 1);
  }

  function removeSlide(index: number) {
    if (slides.length <= 1) return;
    patch((d) => ({ ...d, slides: d.slides.filter((_, i) => i !== index) }));
    setCurrent(Math.max(0, index - 1));
  }

  function moveSlide(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= slides.length) return;
    patch((d) => {
      const next = [...d.slides];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return { ...d, slides: next };
    });
    setCurrent(target);
  }

  async function copy(kind: "deck" | "outline") {
    const text = kind === "deck" ? toDeckFence(active) : deckOutline(active);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="deck-shell">
      <div className="deck-head">
        <SlidesIcon className="h-4 w-4 text-ink-600" />
        <span className="deck-title" title={active.title}>
          {active.title}
        </span>
        <span className="deck-count">
          {slides.length} {slides.length === 1 ? "slide" : "slides"}
        </span>

        <div className="deck-head-actions">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-pressed={editing}
            title={editing ? "Done editing" : "Edit slides"}
            className={`deck-btn ${editing ? "deck-btn-on" : ""}`}
          >
            <PencilIcon className="h-3.5 w-3.5" />
            <span className="deck-btn-label">{editing ? "Done" : "Edit"}</span>
          </button>
          <button
            type="button"
            onClick={() => setPresenting(true)}
            title="Present full screen"
            className="deck-btn deck-btn-primary"
          >
            <PlayDeckIcon className="h-3.5 w-3.5" />
            <span className="deck-btn-label">Present</span>
          </button>
          <button
            type="button"
            onClick={() => printDeck(active)}
            title="Print or save as PDF"
            className="deck-btn"
          >
            <PrinterIcon className="h-3.5 w-3.5" />
            <span className="deck-btn-label">PDF</span>
          </button>
          <button
            type="button"
            onClick={() => downloadDeckPptx(active)}
            title="Download as PowerPoint (.pptx)"
            className="deck-btn"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            <span className="deck-btn-label">PPTX</span>
          </button>
          <button
            type="button"
            onClick={() => downloadDeckHtml(active)}
            title="Download a self-contained HTML deck"
            className="deck-btn"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            <span className="deck-btn-label">HTML</span>
          </button>
          <button
            type="button"
            onClick={() => void copy("deck")}
            title="Copy the deck as a slides block"
            className="deck-btn deck-btn-icon"
            aria-label="Copy deck"
          >
            {copied === "deck" ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div className="deck-body">
        <ol className="deck-rail" aria-label="Slides">
          {slides.map((s, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => setCurrent(i)}
                aria-current={i === safeIndex}
                aria-label={`Slide ${i + 1}: ${s.title || "Untitled"}`}
                className={`deck-thumb ${i === safeIndex ? "deck-thumb-on" : ""}`}
              >
                <span className="deck-thumb-index">{i + 1}</span>
                <span className="deck-thumb-view" aria-hidden>
                  <SlideView slide={s} index={i} deck={active} variant="thumb" />
                </span>
              </button>
            </li>
          ))}
        </ol>

        <div className="deck-main">
          <div className="deck-stage">
            <SlideView slide={slide} index={safeIndex} deck={active} />
          </div>

          <div className="deck-transport">
            <button
              type="button"
              onClick={() => setCurrent(Math.max(0, safeIndex - 1))}
              disabled={safeIndex === 0}
              aria-label="Previous slide"
              className="deck-btn deck-btn-icon"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <span className="deck-pos">
              {safeIndex + 1} / {slides.length}
            </span>
            <button
              type="button"
              onClick={() => setCurrent(Math.min(slides.length - 1, safeIndex + 1))}
              disabled={safeIndex >= slides.length - 1}
              aria-label="Next slide"
              className="deck-btn deck-btn-icon"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>

            <span className="deck-transport-gap" />

            <button type="button" onClick={() => moveSlide(safeIndex, -1)} disabled={safeIndex === 0} className="deck-btn deck-btn-icon" aria-label="Move slide earlier" title="Move earlier">
              ↑
            </button>
            <button type="button" onClick={() => moveSlide(safeIndex, 1)} disabled={safeIndex >= slides.length - 1} className="deck-btn deck-btn-icon" aria-label="Move slide later" title="Move later">
              ↓
            </button>
            <button type="button" onClick={() => duplicateSlide(safeIndex)} className="deck-btn deck-btn-icon" aria-label="Duplicate slide" title="Duplicate slide">
              <CopyIcon className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={addSlide} className="deck-btn deck-btn-icon" aria-label="Add slide" title="Add slide">
              <PlusIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => removeSlide(safeIndex)}
              disabled={slides.length <= 1}
              className="deck-btn deck-btn-icon deck-btn-danger"
              aria-label="Delete slide"
              title="Delete slide"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          {editing && (
            <SlideEditor
              slide={slide}
              index={safeIndex}
              deck={active}
              onChange={(update) => patchSlide(safeIndex, update)}
              onDeckChange={patch}
            />
          )}

          {!editing && (
            <div className="deck-foot">
              <label className="deck-theme">
                <span className="deck-theme-label">Theme</span>
                <select
                  value={active.theme}
                  onChange={(e) => patch((d) => ({ ...d, theme: e.target.value as DeckTheme }))}
                  className="deck-select"
                >
                  {DECK_THEMES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              {slide.notes && <p className="deck-notes">Note: {slide.notes}</p>}
              {onAsk && (
                <button
                  type="button"
                  onClick={() =>
                    onAsk(
                      `Improve this presentation. Keep the same format and the same number of slides, and return the whole deck as one \`\`\`slides block.\n\n${toDeckFence(active)}`,
                    )
                  }
                  className="deck-ask"
                >
                  Ask for changes
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {presenting && (
        <Presenter
          deck={active}
          start={safeIndex}
          onClose={() => setPresenting(false)}
        />
      )}
    </div>
  );
}

/** The form for the selected slide. */
function SlideEditor({
  slide,
  index,
  deck,
  onChange,
  onDeckChange,
}: {
  slide: Slide;
  index: number;
  deck: Deck;
  onChange: (update: (slide: Slide) => Slide) => void;
  onDeckChange: (update: (deck: Deck) => Deck) => void;
}) {
  const effective = effectiveLayout(slide, index);

  return (
    <div className="deck-editor">
      <div className="deck-field">
        <label className="deck-label" htmlFor={`deck-title-${index}`}>
          Title
        </label>
        <input
          id={`deck-title-${index}`}
          value={slide.title}
          onChange={(e) => onChange((s) => ({ ...s, title: e.target.value }))}
          className="deck-input"
        />
      </div>

      <div className="deck-field">
        <label className="deck-label" htmlFor={`deck-sub-${index}`}>
          Subtitle
        </label>
        <input
          id={`deck-sub-${index}`}
          value={slide.subtitle}
          onChange={(e) => onChange((s) => ({ ...s, subtitle: e.target.value }))}
          placeholder="Optional"
          className="deck-input"
        />
      </div>

      <div className="deck-field">
        <label className="deck-label" htmlFor={`deck-layout-${index}`}>
          Layout
        </label>
        <select
          id={`deck-layout-${index}`}
          value={effective}
          onChange={(e) => onChange((s) => ({ ...s, layout: e.target.value as SlideLayout }))}
          className="deck-select deck-select-block"
        >
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="deck-field">
        <label className="deck-label" htmlFor={`deck-body-${index}`}>
          Body
        </label>
        <textarea
          id={`deck-body-${index}`}
          value={slide.body.join("\n\n")}
          onChange={(e) =>
            onChange((s) => ({
              ...s,
              body: e.target.value.split(/\n{2,}/).map((v) => v.trim()).filter(Boolean),
            }))
          }
          rows={3}
          placeholder="One paragraph per blank line"
          className="deck-textarea"
        />
      </div>

      <div className="deck-field">
        <label className="deck-label" htmlFor={`deck-bullets-${index}`}>
          Bullets
        </label>
        <textarea
          id={`deck-bullets-${index}`}
          value={slide.bullets.join("\n")}
          onChange={(e) =>
            onChange((s) => ({
              ...s,
              bullets: e.target.value.split("\n").map((v) => v.trim()).filter(Boolean),
            }))
          }
          rows={4}
          placeholder="One bullet per line"
          className="deck-textarea"
        />
        <label className="deck-check">
          <input
            type="checkbox"
            checked={slide.ordered}
            onChange={(e) => onChange((s) => ({ ...s, ordered: e.target.checked }))}
          />
          Numbered
        </label>
      </div>

      {(effective === "quote" || slide.quote) && (
        <div className="deck-field">
          <label className="deck-label" htmlFor={`deck-quote-${index}`}>
            Quote
          </label>
          <textarea
            id={`deck-quote-${index}`}
            value={slide.quote}
            onChange={(e) => onChange((s) => ({ ...s, quote: e.target.value }))}
            rows={2}
            className="deck-textarea"
          />
        </div>
      )}

      <div className="deck-field">
        <label className="deck-label" htmlFor={`deck-image-${index}`}>
          Image URL
        </label>
        <input
          id={`deck-image-${index}`}
          value={slide.image}
          onChange={(e) => onChange((s) => ({ ...s, image: e.target.value }))}
          placeholder="https://…"
          className="deck-input"
        />
      </div>

      <div className="deck-field">
        <label className="deck-label" htmlFor={`deck-notes-${index}`}>
          Speaker notes
        </label>
        <textarea
          id={`deck-notes-${index}`}
          value={slide.notes}
          onChange={(e) => onChange((s) => ({ ...s, notes: e.target.value }))}
          rows={2}
          placeholder="Shown here, hidden when presenting"
          className="deck-textarea"
        />
      </div>

      <div className="deck-field">
        <label className="deck-label" htmlFor={`deck-decktitle-${index}`}>
          Deck title
        </label>
        <input
          id={`deck-decktitle-${index}`}
          value={deck.title}
          onChange={(e) => onDeckChange((d) => ({ ...d, title: e.target.value }))}
          className="deck-input"
        />
      </div>
    </div>
  );
}

/**
 * Full-screen presentation. Arrow keys, space and click advance; Esc leaves.
 * The chrome is hidden until the pointer moves, so the slide is the only thing
 * on screen while presenting.
 */
function Presenter({
  deck,
  start,
  onClose,
}: {
  deck: Deck;
  start: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(start);
  const [chrome, setChrome] = useState(true);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (["ArrowRight", "ArrowDown", " ", "PageDown", "Enter"].includes(event.key)) {
        event.preventDefault();
        setIndex((i) => Math.min(deck.slides.length - 1, i + 1));
      } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
        event.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (event.key === "Home") setIndex(0);
      else if (event.key === "End") setIndex(deck.slides.length - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deck.slides.length, onClose]);

  // Lock the page behind the overlay so a stray scroll does not move the deck.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  function nudge() {
    setChrome(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setChrome(false), 2600);
  }

  const slide = deck.slides[Math.min(index, deck.slides.length - 1)];

  return (
    <div
      className="deck-present"
      onMouseMove={nudge}
      onClick={() => setIndex((i) => Math.min(deck.slides.length - 1, i + 1))}
      role="dialog"
      aria-modal="true"
      aria-label={`Presenting ${deck.title}`}
    >
      <div className="deck-present-stage">
        <SlideView slide={slide} index={index} deck={deck} />
      </div>

      <div className={`deck-present-bar ${chrome ? "is-on" : ""}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} className="deck-present-btn" aria-label="Previous slide">
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <span className="deck-present-pos">
          {index + 1} / {deck.slides.length}
        </span>
        <button type="button" onClick={() => setIndex((i) => Math.min(deck.slides.length - 1, i + 1))} disabled={index >= deck.slides.length - 1} className="deck-present-btn" aria-label="Next slide">
          <ChevronRightIcon className="h-4 w-4" />
        </button>

        <span className="deck-present-gap" />

        <button
          type="button"
          onClick={async () => {
            const el = document.documentElement;
            if (document.fullscreenElement) await document.exitFullscreen();
            else await el.requestFullscreen?.();
          }}
          className="deck-present-btn"
          aria-label="Toggle full screen"
          title="Full screen"
        >
          <ExpandIcon className="h-4 w-4" />
        </button>
        <button type="button" onClick={onClose} className="deck-present-btn" aria-label="Exit presentation" title="Exit (Esc)">
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      {slide.notes && chrome && <div className="deck-present-notes">{slide.notes}</div>}
      {!chrome && (
        <span className="deck-present-hint" aria-hidden>
          <CollapseIcon className="h-3.5 w-3.5" /> Esc to exit
        </span>
      )}
    </div>
  );
}
