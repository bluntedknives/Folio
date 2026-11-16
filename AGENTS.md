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
- Model choice is automatic (`routeFor` in `src/lib/models.ts`). The API
  route rejects any model outside the allow-list.

## Credentials

Two separate credentials, stored in two different places. Do not mix them up.

- **`NVIDIA_API_KEY`** — powers the app. Lives in `.env.local` (gitignored),
  read server-side only. This is what makes chat, vision and YouTube work.
  Get one at <https://build.nvidia.com>. `.env.example` holds the placeholder
  shape; never put a real key there or in any other tracked file.
- **GitHub access** — for pushing this repo. It is *not* a `GITHUB_TOKEN`
  environment variable. OpenHands brokers it: the account token sits in
  `~/.openhands/git-credentials/github.token`, and git calls
  `~/.openhands/git-credential-helper`, which exchanges it for a
  short-lived installation token via
  `https://app.all-hands.dev/api/v1/webhooks/secrets`. Git config wires this up
  as `credential.https://github.com.helper`, so a plain `git push` just works
  once access is granted. Exporting `GITHUB_TOKEN` does not affect `git push`;
  only `gh` reads that.

**Persisting a credential across sessions.** Environment variables set in a
shell do not survive into the next conversation. To make one available every
time, save it as a workspace secret in the OpenHands UI — `Settings > Secrets >
Add a new secret`, name it exactly as the variable should appear (e.g.
`NVIDIA_API_KEY`), and it is exported into the shell for conversations started
after the save. The same panel is where an expired key gets replaced. Secrets
are matched by name anywhere in a bash command and their values are masked in
output, so reference them as `$NVIDIA_API_KEY` rather than pasting the literal.
Note this does not help the brokered GitHub credential above, which is
authorized through the GitHub connection rather than a secret.

**If a push is denied with `403 ... Permission to <owner>/<repo>.git denied`.**
Read access working while write fails means the GitHub connection was authorized
without write permission. `git ls-remote` succeeding is the tell. The brokered
integration token cannot administer the repo either, so registering a deploy key
through it fails with `403 Resource not accessible by integration`.

The working fix is an SSH **deploy key** with write access, which bypasses the
brokered connection entirely:

- The keypair is at `/workspace/.secrets/folio_deploy` (private) and
  `folio_deploy.pub` (public). `/workspace` is a persistent volume; `~/.ssh` is
  not, so the key lives outside the home directory on purpose. It sits beside
  the repo rather than inside it, so it can never be committed.
- `sh /workspace/.secrets/setup-ssh.sh` rebuilds `~/.ssh` (config, known_hosts,
  permissions) from that key and is safe to re-run. Run it after a container
  reset. `openssh-client` may need reinstalling first.
- The remote uses SSH (`git@github.com:bluntedknives/Folio.git`). An
  `origin-https` remote is kept as a fallback.
- The public key must be added on GitHub as a deploy key **with "Allow write
  access" enabled**, otherwise the push still fails while reads succeed.
- `Permission denied (publickey)` means the key is offered correctly but is not
  authorized on GitHub yet. `ssh -v -T git@github.com` shows the fingerprint
  being offered.

**Commit authorship must be the repo owner.** Vercel only deploys commits it can
attribute to a GitHub account. Commits authored as `openhands
<openhands@all-hands.dev>` are unlinked, so a deploy of such a commit is
skipped. Commit as:

```
bluntedknives <256161244+bluntedknives@users.noreply.github.com>
```

`~/.gitconfig` is on the ephemeral overlay, so set this per checkout with
`git config user.name/user.email` (persists on `/workspace`) and let
`setup-ssh.sh` restore the global copy after a reset. To fix history that is
already pushed, rewrite authorship over the unpushed range and force-push:

```
git filter-branch -f --env-filter 'export GIT_AUTHOR_NAME=...; ...' <base>..HEAD
git push --force-with-lease origin <branch>
```

Verify with `git log --format="%h %an"` and confirm the GitHub API reports a
linked author. The tree hash is unchanged by an authorship rewrite, so the code
itself is untouched.

**Never commit a credential.** `.env*` is gitignored and only `.env.example` is
tracked; keep it that way. Before pushing, confirm with
`git grep -nE "(nvapi-[A-Za-z0-9_-]{15,}|gh[pous]_[A-Za-z0-9]{20,}|github_pat_)"`
that nothing leaked into a tracked file.

## Deploying (Vercel)

Vercel builds **`main`**. A feature that exists only on a side branch is not
live, however green the preview is: video support was once complete and tested
on `feat/desmos-graphing` while `main` had no `youtube*.ts` at all, so the
deployed app answered a video question with an improvised monologue. Before
reporting a feature broken, confirm the code is on `main`:

```
git ls-tree -r --name-only origin/main | grep -iE "youtube"
```

**Vercel needs `NVIDIA_API_KEY` set in the project's environment variables.**
`.env.local` is gitignored and does not travel with the repo, so a fresh
deployment answers every request with `Server is missing NVIDIA_API_KEY`. Set
it under Project -> Settings -> Environment Variables for Production, Preview
and Development, then redeploy. This step is manual: it cannot be done from
here.

`main` has been a clean fast-forward of the feature branch (`git push origin
HEAD:main`); keep it that way rather than merging, so the two stay identical.

## Gotchas

- `next dev` rewrites the block at the top of this file. Commit it with your
  work so the tree stays clean.
- eslint rejects `setState` called synchronously in an effect
  (`react-hooks/set-state-in-effect`). Use `useSyncExternalStore` for external
  state such as the DOM.
- Graph curve colours come from `PALETTE` in `src/lib/graph/spec.ts`, which
  resolves `var(--g1..--g6)` so the same spec renders on both canvases.
- Graphs are drawn locally into SVG by `Graph.tsx` — no script, no API key, no
  network. The renderer imitates Desmos: minor and major gridlines, axes pinned
  to the origin or the nearest edge, arrowheads, italic axis names, and Desmos'
  own curve palette (`--g1..--g7`, reordered in `PALETTE`). Colours, paper and
  grid all resolve through CSS variables (`--graph-paper`, `--graph-grid`,
  `--graph-grid-minor`, `--graph-axis`) so both themes work from one code path.
  The Desmos API was removed deliberately: it cannot be embedded without a key
  (every script version 403s without one), so a "Desmos" button would have been
  either broken or dependent on a trial key.
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
- Study mode is built as a media player, because that is the mental model the
  user asked for. The live screen sits on a 16:9 stage as the video, the answer
  plays out beneath it, revealed a character at a time, and the transport has a
  single Answer button, elapsed time and full screen. There is no pause: reading
  is driven by the button, so the answer never advances on its own. The stage
  shows the same frame the model is given, so what is on screen is exactly what
  is read. Nothing is written to storage, so the transcript is gone when the
  panel closes.
- Pause holds both halves: the reader stops sampling and the reveal stops
  advancing. Resuming reads the screen immediately if it moved while paused,
  rather than waiting for the next sample, so unpausing captures whatever is on
  screen at that moment.
- Study mode reads on demand, not automatically: sharing a screen shows the
  live picture, and the Answer button captures whatever is on screen and sends
  it. The ask box is the same path with a typed question, and passes `explicit`
  so it runs even while another answer streams and never falls back to the
  default prompt. Without that flag the ask box silently sent "Read this and
  solve the question on screen." instead of what was typed.
- Expanded study mode bounds the stage by height (`46vh`), not just width. A
  16:9 box sized by width is taller than a wide viewport, so the transport and
  the answer were pushed below the fold and the expanded player looked like a
  black screen with only the header showing.
- Chat persistence has two rules that are easy to regress. A sent message is
  written immediately, not on the debounce: reloading within the first second
  after sending used to lose the question entirely. And hydrate must not
  overwrite a conversation the user has already started, or typing before the
  store is ready is silently replaced by the most recent stored chat.
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
- **Reasoning is off unless the model is the deep one.** `thinkingFor` in
  `src/lib/models.ts` decides from the model's `tier`, and the API route passes
  it as `chat_template_kwargs.enable_thinking`. Leaving it on for every call is
  the main cause of "it takes too long to think": on this account it took a
  conceptual question from 1.2s to 5.3s and a calculus problem from 2.1s to
  7.0s, for the same answer. The decision hangs off the model, not the route, so
  the vision override in the route keeps the right setting too.
- **YouTube is described, not watched.** `src/lib/youtube-server.ts` reads what
  answers a plain request: oEmbed for the title and channel, the watch page's
  `ytInitialData` for description/duration/publish date, and four distinct
  stills (`maxresdefault`, `hq1..hq3`). The transcript is not available: every
  caption route (`timedtext`, InnerTube `get_transcript`, the player's
  `captionTracks`) is refused for a datacenter IP, and the public mirrors are
  blocked or need a token. So the model is told plainly that it has no audio and
  no transcript, and the prompt requires it to say so rather than invent spoken
  content. Do not add a "transcript" field without verifying one is reachable —
  a fabricated transcript is worse than an honest "I can only see the frames".
- `ytInitialData` must be extracted with the brace matcher in
  `youtube-server.ts`, not a regex. The blob has nested objects and escaped
  quotes, so a regex grabs a truncated prefix and `JSON.parse` throws.
- The video id is the only thing that travels with a conversation. The client
  sends it (from the newest user turn, `latestVideoId`), and the server re-reads
  the video per turn, so no metadata is stored and a title cannot go stale. A
  follow-up that does not repeat the link still finds the video. Frames are
  attached to the last user turn only.
- A video carries images, so the route must be corrected to the vision model
  when the text-based choice cannot see. The check is
  `getModel(...)?.vision` in `src/app/api/chat/route.ts`; without it the image
  parts go to a text-only model and the whole request is rejected.
- The system prompt's length contract is load-bearing. "Be shorter than you
  think you should" did not stop a one-line question getting an essay; naming
  the bands (one-liner, normal, explicit essay) and adding a final
  delete-anything-that-is-not-the-answer pass did. Keep the concrete examples.
- Reading a linked page reuses the video path's shape: the URL is the only
  thing that travels, the server fetches it per turn, and nothing is stored.
  Search is skipped when a page is linked, because the page is the source.
- `page-server.ts` refuses a URL unless it is http(s) on port 80/443, resolves
  to public addresses only, and every redirect hop is re-checked. The private
  and link-local ranges are refused in both IP versions; the link-local block
  is what stops a fetch from reaching the cloud metadata address. Redirects are
  followed by hand, so a public URL cannot bounce the fetch inward. There is a
  residual DNS-rebinding window between the address check and the request; it
  is noted in the module rather than pretended away.
- Study mode's stage went black when floated on top because portalling the
  panel into the picture-in-picture document adopts the `<video>` into that
  document, which detaches its stream: the element returns paused with a
  zero-sized frame, and `grabFrame` then reads a `videoWidth` of 0. Any panel
  that moves between documents must re-attach the stream afterwards. Do not
  portal a live `<video>` without this.
- Screen-change detection compares a 64x64 greyscale fingerprint and counts
  changed cells, not the mean difference. On ink on white the mean is useless:
  two different questions measured 0.0024 apart at 16x16, under a 0.06
  threshold, so nothing would ever have triggered. The count separates a moving
  cursor (0.0020) from replaced questions (0.0088). Calibrate with
  `signatureDistance` against a real page before changing `SIGNATURE_EDGE` or
  the thresholds in `StudyMode.tsx`; the numbers are measurements, not guesses.
- Study mode's audio is the shared surface's track, recorded per question and
  sent as a clip. `getDisplayMedia` only offers it for a tab or the whole
  screen, and only Chromium, so a missing track is normal and is surfaced in
  the UI rather than treated as an error.
- Image generation is not available on this account. All 33 models are text,
  vision or audio, and `/v1/images/generations` returns 404. Do not build a
  feature that assumes it; re-check before promising it.
