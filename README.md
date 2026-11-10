# folio

A homework helper for any assignment: maths, science, essays, code.
No signup. Nothing is stored on a server. History lives in your browser.

## What it does

- Streams answers token by token, with a collapsible panel for the model's
  reasoning so you can watch it work.
- Renders maths with KaTeX and code in syntax-highlighted blocks with a copy
  button. `\(...\)` and `\[...\]` delimiters are rewritten to the dollar form
  the renderer understands, without touching fenced code.
- Draws graphs. The model can emit a `graph` block and it renders as an
  interactive plot: drag to pan, scroll to zoom, hover to read values off each
  curve.
- Has a plotter. A built-in graphing panel where you type your own curves and
  ranges, watch them draw live, and send the plot into the chat to be explained.
  It uses the same parser and renderer as the model's graphs.
- Reads photos. Attach a picture of a worksheet, diagram or handwriting and it
  is routed to the vision model automatically. Images are re-encoded through a
  canvas first, so EXIF, GPS, camera details and embedded thumbnails are
  stripped before the bytes ever leave the browser.
- Picks the model for you. Attach an image and it uses the vision model; a long
  or obviously hard prompt reaches for the strongest one. No dropdown.
- Light and dark themes. Light is the default, the toggle sits in the sidebar
  footer, and the choice is remembered. A small script in the document head
  applies the theme before first paint, so there is no flash on load.
- Saves chats locally. Conversations persist under an opaque key with a
  base64-encoded payload, which keeps history from being casually readable in
  devtools. That is obfuscation, not encryption: anyone with access to this
  machine can decode it, so the sidebar offers a clear-all button.
- Exports a conversation as Markdown.

## Setup

```bash
npm install
cp .env.example .env.local   # then put your key in it
npm run dev
```

Open http://localhost:3000.

Get a key at https://build.nvidia.com. The app talks to
`https://integrate.api.nvidia.com/v1`.

## The key stays on the server

`NVIDIA_API_KEY` has no `NEXT_PUBLIC_` prefix, so Next.js never inlines it into
the browser bundle. The browser calls `/api/chat`; only that route handler ever
sees the key, and it is never sent back in a response. `.env*` is gitignored.

## Models

There is no model picker. `routeModel` in `src/lib/models.ts` chooses per
message, so the student never has to think about it:

- an attached image always goes to the vision model;
- a long prompt goes to the strongest model;
- wording that signals real work (derive, prove, integrate, step by step,
  essay) also goes to the strongest model, however short the prompt;
- a one-liner goes to the quickest model;
- everything else goes to the fast default.

Only models verified live on the account behind the key are in the catalogue,
and the API route rejects anything else:

| Label | Model | Images | Chosen for |
| --- | --- | --- | --- |
| Lightning | `nvidia/nemotron-3.5-lightning-30b-a3b` | no | most questions |
| Nano | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | no | short, quick questions |
| Ultra | `nvidia/nemotron-3-ultra-550b-a55b` | no | long prompts, hard problems |
| Vision | `nvidia/nemotron-3.5-super-vl-120b-a12b` | yes | anything with a photo |

A follow-up question about a photo still routes to the vision model, so the
image stays readable. Images on older turns are dropped for text models rather
than failing the conversation.

## Layout

```
src/app/api/chat/route.ts   server-only proxy, holds the key
src/lib/brand.ts            product name and storage namespace
src/lib/validation.ts       request limits and model allow-list
src/lib/store.ts            local persistence and legacy-key migration
src/lib/theme.ts            theme key and the pre-paint script
src/lib/image.ts            canvas re-encode, the metadata scrub
src/lib/api.ts              SSE parsing, splits reasoning from answer
src/lib/math/expression.ts  tokeniser + parser, no eval anywhere
src/lib/graph/spec.ts       parses a ```graph block into a spec
src/lib/graph/build.ts      builds the same spec from plotter input
src/components/             UI
```

The expression evaluator has no `eval` or `new Function`. Source is tokenised,
parsed to an AST, and only a fixed table of functions is reachable, so a graph
block can never execute code.
