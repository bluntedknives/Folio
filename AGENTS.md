<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project

`folio` — a local-first homework helper. Next.js (app router) + React +
Tailwind v4. Chats live in `localStorage`; the only network call is
`/api/chat`, which proxies the NVIDIA API with a server-side key.

## Commands

```bash
npm run dev            # dev server
npm run build          # production build (also typechecks)
npx tsc --noEmit       # types only
npx eslint src --max-warnings=0
npm run start -- -p 12000
```

## Conventions

- **Design tokens live in `src/app/globals.css`.** Light is the default; the
  `.dark` class on `<html>` flips the ramp. The ramp runs dark-on-light in
  light mode and light-on-dark in dark mode, so component classes
  (`text-ink-900`, `bg-ink-100`, `border-stroke`) stay identical across themes.
  Do not branch on theme in components; add a token instead.
- `--solid-bg` / `--solid-fg` invert per theme — use `bg-solid text-solid-fg`
  for filled buttons, never `bg-ink-900 text-ink-0`.
- Theme is applied before paint by `THEME_SCRIPT` (`src/lib/theme.ts`) inlined
  in the layout head, so there is no flash. `ThemeToggle` reads the DOM class
  through `useSyncExternalStore` rather than mirroring it in state.
- The key never reaches the browser: `NVIDIA_API_KEY` has no `NEXT_PUBLIC_`
  prefix. `.env*` is gitignored; only `.env.example` (placeholder) is tracked.
- Model choice is automatic (`routeModel` in `src/lib/models.ts`). The API
  route rejects any model outside the allow-list.

## Gotchas

- `next dev` rewrites the block at the top of this file. Commit it with your
  work so the tree stays clean.
- eslint rejects `setState` called synchronously in an effect
  (`react-hooks/set-state-in-effect`). Use `useSyncExternalStore` for external
  state such as the DOM.
- Graph curve colours come from `PALETTE` in `src/lib/graph/spec.ts`, which
  resolves `var(--g1..--g6)` so the same spec renders on both canvases.
- Graphs have two engines. `Graph.tsx` draws locally into SVG (default, no
  network). The Desmos button lazily loads `src/components/graph/desmos.ts`,
  which maps the same `GraphSpec` onto the Desmos API. Desmos paints its own
  canvas, so it takes theme colours as constructor options
  (`invertedColors`, `backgroundColor`) rather than reading CSS. If the 4 MB
  script fails to load, the component silently falls back to the local plotter.
  Set `NEXT_PUBLIC_DESMOS_API_KEY` for a production key; otherwise the public
  trial key is used, which logs a prototyping warning.
- The `graph` fence tag is matched three ways in `Markdown.tsx`: as a normal
  language tag, nested inside another fence (`unwrapFence`), and on a line of
  its own (`detectTaglessSpec`). The last case needs the body to parse before
  it draws, so a plain snippet that starts with the word "graph" stays code.
  Keep that guard: without it, ordinary code renders as an empty plot.
- A user's question and their attachments are separate wire fields. In
  `toUpstream` the question is unshifted as its own text part even when the
  attachment notes already added one, so the model never sees an image with no
  question attached.
- Study mode (`StudyMode.tsx`) captures the screen with `getDisplayMedia` and
  floats the panel using Document Picture-in-Picture, which is what keeps it
  visible over another tab or app. The panel is rendered with `createPortal`
  into the PiP window's `document.body`, so React state stays in the main
  document while the DOM lives in the floating window. `copyStyles` clones the
  stylesheets across and a `MutationObserver` on `<html>` keeps the theme class
  in step, otherwise the floating window renders unstyled and light.
- Study mode is automatic: sharing a screen is the only input. The panel
  samples the screen and asks the vision model by itself. A still page is the
  normal case, so the first settled page is read even though nothing "changed";
  comparing only against the previous frame means a worksheet that never moves
  is never read at all, which is the bug this replaced. Reads are compared
  against the last page that was *read*, so a page is read once and a noisy
  screen is not read over and over. There is no play button, and the transcript
  is never written to storage, so it disappears when the panel closes.
- The auto loop yields while an answer streams, so the answer's own repaint is
  not read as a new page. A question the user types is the exception: it passes
  `explicit`, runs during a stream, and never falls back to the default prompt.
  Without that flag the ask box silently sent "Read this and solve the question
  on screen." instead of what was typed.
- In-flight requests are tracked in a `Set` rather than a single ref. One ref
  means a second request clears the first one's handle, so aborting on close
  leaves the other stream running and the busy flag is cleared too early.
- The panel is a `position: fixed` card, so it sits on top of the shared screen
  and the model can read the card instead of the assignment. Two escapes: the
  minimize control collapses it to a header-only pill, and "Float on top" moves
  it into a Document Picture-in-Picture window, which is a separate OS window
  and so never appears in a screen capture of the page.
- Captured frames are geometrically complete. Verified by painting marker blocks
  in all four corners of a 1440x1200 source and sampling the corners of the
  bytes actually sent upstream: all four arrive, full size, correct aspect. If a
  capture ever looks cropped, check the thumbnail: `object-fit: cover` on a
  4:3 box crops the sides of a wide frame. It uses `contain` for that reason.
- A PiP window's document is separate: anything the panel renders must be inside
  the portal, and a stylesheet copy plus a MutationObserver on `<html>` keeps the
  theme class in step. In headless Chromium the PiP window opens but is not
  composited.
- History lives in IndexedDB, not localStorage, because a browser extension's
  content script shares the page's localStorage and can read it. The object
  store is keyed by `id`, so the payload rides in a `data` field: putting the
  encoded string in directly fails with a DataError, since a string has no `id`
  property. Legacy localStorage records are always swept on hydrate and moved
  across, and a record already in IndexedDB wins so a re-run cannot clobber it.
