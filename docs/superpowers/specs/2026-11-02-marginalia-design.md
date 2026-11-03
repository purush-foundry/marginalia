# Marginalia — design

A very light paper (PDF) reader for one person. Runs as a web app / installable PWA on a
Linux laptop (Chrome), iPhone and iPad (Safari, home-screen app). Papers live in one Google
Drive folder the user picks; the app mirrors that folder tree, caches PDFs locally, and
stores every annotation in a small JSON sidecar next to the PDF so nothing is locked in.

## Intent

The owner reads many ML/robotics papers (arXiv). They want to: drop a PDF into a Drive
folder from any device and have it appear everywhere; highlight passages in a few colours;
draw on the page with a mouse (laptop) or Apple Pencil (iPad); ask Claude about a highlighted
passage, equation or figure and get an answer that cites the paper; and have the UI be
obvious with no modes to get trapped in. "Super light" is a hard requirement: fast open,
small bundle, no backend, no accounts beyond Google + an Anthropic key.

## Goals

- Open a paper in under two seconds from the local cache; first page visible before the rest.
- Highlight text in 4 colours, highlight an area (equations, figures), draw with pen/eraser.
- Ask Claude about any highlight/area; answers cite page + passage; threads persist per paper.
- Library = the Drive folder tree, read-only mirror, with unread/reading/done badges.
- Annotations sync across devices through Drive; local-first, offline reading works.
- Works identically on mouse, touch and Pencil without mode traps.

## Non-goals (v1)

Reference management, metadata lookup, tags, cross-library search, multi-document canvases,
social features, flashcards, PDF reflow, burning annotations into PDFs, collaboration,
moving/renaming files in Drive from the app.

## Anti-goals

- A latched highlighter that steals finger scrolling (Zotero iPad's famous trap).
- Silent loss of annotations. Every edit is in IndexedDB before any network call.
- Anything that makes the app slower to open (heavy frameworks, large dependency trees).
- Claude answers without visible provenance.

## Constraints and platform decisions

- **Stack:** TypeScript, Vite 8, Preact 11 + `@preact/signals`, `pdfjs-dist` 6.5,
  `perfect-freehand` 1.2. No other runtime dependencies without the owner's say.
- **Hosting:** static, GitHub Pages at `https://purush-foundry.github.io/marginalia/`
  (`npm run deploy` pushes `dist/` to `gh-pages`). Vite `base` is `/marginalia/` in builds.
- **Browsers:** Chrome current; Safari/iOS 18+ (pdf.js 6 minimum).
- **Google Drive:** Google Identity Services token model (implicit, popup from a user
  gesture; redirect fallback on iOS if the popup fails). Scopes
  `https://www.googleapis.com/auth/drive.readonly` + `https://www.googleapis.com/auth/drive.file`:
  read anything, write only files the app created (sidecars). The app restricts itself to one
  root folder (chosen at first run) and its subfolders; that restriction is enforced in the
  app, not by Google. Consent screen is "In production" (unverified; personal use) so consent
  does not expire every 7 days. No service accounts, no backend.
- **Claude:** direct browser calls to the Messages API (`anthropic-dangerous-direct-browser-access`
  header), streaming. Key pasted into Settings once per device, kept in IndexedDB, never in
  the sidecar, never in a URL. Default text model `claude-haiku-5-5`; figures/equations and
  "think harder" use `claude-opus-5-5`. Images (page crops) go as `image` blocks, long edge
  ≤ 2576 px.
- **Storage:** IndexedDB for PDF blobs (keyed by Drive fileId + version), sidecars, settings,
  library index, pending-write queue. `navigator.storage.persist()` requested on first launch.
  Own LRU cap on cached PDFs (1 GB).
- **Sidecar:** `<pdf name without .pdf>.marginalia.json` in the same Drive folder as the PDF,
  tagged with `appProperties { marginalia: "1", pdf: <pdfFileId> }`. Schema in `src/types.ts`.
  Merge rule: per item by `id`, newest `updatedAt` wins, deletions are tombstones
  (`deleted: true`), reading state newest-wins. Never overwrite a remote sidecar without
  merging first.
- **Coordinates:** every annotation box/point is normalised to the unrotated page:
  `x, y, w, h ∈ [0, 1]` of page width/height, origin top-left. Pages are 1-based.
- **Annotation rendering** is our own per-page overlay (SVG for highlights, canvas/SVG for
  ink), not pdf.js's annotation editors.
- **PWA:** `manifest.webmanifest`, `display: standalone`, hand-written service worker that
  precaches the built shell (cache-first for hashed assets, network-first for navigation),
  never caches Google/Anthropic calls or PDFs. Safe-area insets, `100dvh`, fixed app shell with
  its own scroll container.

## Interaction model (the part that must be right)

**Tool state belongs to the input, never to the document.**

- Finger and mouse are always: scroll, tap, select text. There is no highlighter mode for them.
- Selecting text (mouse drag, finger long-press-drag, Pencil drag while in Select tool) shows
  a floating **selection bar** at the end of the selection: 4 colour dots, Ask, Note, Copy.
  Tap outside → nothing created. Tap a colour → highlight created, bar closes.
- Tap an existing highlight → the same bar with Delete, colour change, Ask, Note.
- **Area select:** a toolbar button (laptop) or long-press on non-text (touch) starts a
  rectangle drag; releasing shows the same bar. This is how equations/figures are annotated and
  asked about (the crop image is sent to Claude).
- **Pencil** owns a tool: Pen / Eraser / Select. Finger never draws (preference to allow it).
  Pen draws fixed-width strokes with pressure-shaped ends; Eraser erases whole strokes; while
  a pen pointer is down, touch pointers are ignored (palm rejection) and the drawing surface has
  `touch-action: none`. Pencil double-tap is not available to web apps, so the tool strip is
  always visible on iPad. On the laptop, a "Draw" button latches pen mode for the mouse with a
  visible border; Esc or tapping the button exits.
- Visible Undo/Redo buttons (plus Cmd/Ctrl-Z). Two-finger double-tap = undo on touch.
- **Ask:** from the bar → side panel (laptop/iPad) or bottom sheet (phone). Shows "Sending N
  words from p.X (+ image)" and a streaming answer. Four chips: Explain · Define here ·
  Unpack the maths · Why does it matter. Follow-up questions continue the thread. Answers quote
  passages; a quoted passage with a page number is a link that scrolls the viewer there.
  Threads are saved in the sidecar and listed in the sidebar with a marker at their anchor.
- **Sidebar** (laptop/iPad; sheet on phone): Outline (PDF outline, or none), Highlights in
  reading order with colour filter, Threads.
- **Reading comfort:** continuous scroll, fit-width default, pinch/ctrl-wheel zoom re-renders at
  scale, per-paper margin crop on phone, double-tap column zoom on phone, Night mode that inverts
  page + text but not images (separate "invert images" switch), last position restored.
- **Two-column papers:** a text selection is clamped to the column it started in; the highlight
  list is ordered by column then y.
- **Library:** folder tree exactly as in Drive (folders first, then PDFs, alphabetical),
  breadcrumbs, unread/reading/done badge, sync status, "Reconnect Drive" when the token is gone.
- **Export:** "Copy as Markdown" per paper: title, then each highlight as a quote with colour
  label, page, note, and crops as data: URLs are NOT included (links to page instead).

## Sync model

- Library: on launch/visibility and every 60 s while visible, walk the root folder tree with
  `files.list` (`'<id>' in parents and trashed=false`), batching parents with `or`. Diff against
  the stored index; new PDFs appear in the tree immediately and download on open (or on tap of
  "cache"). Use `changes.list` when a start token exists, falling back to a full walk.
- Sidecar: load local → render immediately → fetch remote metadata (`version`) → if newer,
  download, merge, re-render. Local edits are debounced (1.5 s) to IndexedDB and queued; the
  queue flushes when a token is valid: read remote version, merge if moved, upload
  (`uploadType=media` PATCH, or multipart POST to create). Failures stay queued.
- Token: 1-hour access token cached with expiry in IndexedDB; renewal only from a user gesture
  (any tap when < 5 min remain); if expired, the UI shows a one-tap "Reconnect Drive" button
  and everything else keeps working offline.

## What's left to the builder

Visual design (keep it quiet: one accent colour, system font, 44 px touch targets), exact
heuristics for column clustering, keyboard shortcuts beyond Undo/Redo, LRU details, SW update
toast wording, the exact prompt text for Claude (must insist on quoting the paper, must say
"not in the paper" when it isn't), and icon artwork.
