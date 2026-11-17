"use client";

import { effectiveLayout, type Deck, type Slide } from "@/lib/slides/spec";

/**
 * One slide, drawn identically on the canvas, in a thumbnail and while
 * presenting, so a slide never looks different in the editor than it does on
 * the projector. The theme is carried on `data-theme` and resolved to CSS
 * variables, which is what lets five deck themes work in both app themes from
 * a single code path.
 */
export function SlideView({
  slide,
  index,
  deck,
  variant = "canvas",
}: {
  slide: Slide;
  index: number;
  deck: Deck;
  variant?: "canvas" | "thumb";
}) {
  const layout = effectiveLayout(slide, index);
  const showFooter = Boolean(deck.footer);

  return (
    <div className={`deck-slide layout-${layout} variant-${variant}`} data-theme={deck.theme}>
      <div className="deck-slide-inner">
        {slide.title && <h3 className="deck-h">{slide.title}</h3>}
        {slide.subtitle && <p className="deck-sub">{slide.subtitle}</p>}

        <div className="deck-content">
          {slide.body.map((line, i) => (
            <p key={i}>{line}</p>
          ))}

          {slide.bullets.length > 0 &&
            (slide.ordered ? (
              <ol className="deck-list">
                {slide.bullets.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ol>
            ) : (
              <ul className="deck-list">
                {slide.bullets.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ))}

          {slide.quote && <blockquote className="deck-quote">{slide.quote}</blockquote>}

          {slide.code && (
            <pre className="deck-code">
              <code>{slide.code.text}</code>
            </pre>
          )}

          {slide.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="deck-img" src={slide.image} alt="" />
          )}
        </div>
      </div>

      {showFooter && <div className="deck-footer">{deck.footer}</div>}
    </div>
  );
}
