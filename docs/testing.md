# Testing Marginalia

## Automated

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npx tsc -b && npx vitest run && npm run build
```

Vitest runs in happy-dom. The shell's own tests, and what the final fix wave added:

- `src/app/settings.test.ts` — defaults from `config.ts`, save and reload, client id fallback.
- `src/library/Library.test.tsx` — the library tree from a fake Drive folder, reading badges from
  local sidecars, cached dots, breadcrumbs and route links, Reconnect Drive on expiry; a badge
  follows a reading state another device synced to Drive.
- `src/app/Reader.test.tsx` — reader wiring with the viewer, PDF and Drive layers mocked: open →
  store created → status `reading` → selection → highlight added → persisted; note and delete on a
  tapped highlight; the viewer selection is cleared after bar actions and on dismiss; flush and
  release on close; a newer remote reading state wins on open (the viewer scrolls there, nothing is
  stamped until the user scrolls); restore-time positions are not persisted; closing queues the
  store state only after an edit; closing turns the Draw latch off; a cached PDF pdf.js cannot open
  is replaced by a fresh download.
- `src/drive/library.test.ts` — Drive mirror, sidecar save/flush/merge and PDF cache against a fake
  Drive: a failed IndexedDB write keeps the edit and retries; `refreshSidecar` finds a sidecar the
  index has not seen; sync pulls other devices' sidecars, and one failed download neither stops the
  others nor hides the count; offline uploads and downloads report offline; a sidecar deleted in
  Drive is recreated; queue entries outside the library are dropped; PDFs are cached as bytes,
  legacy Blob records migrate or re-download, `fresh` downloads, and a failed openedAt write still
  returns the PDF.
- `src/drive/auth.test.ts` — GIS token flow with a stubbed `window.google`: 60 s request timeout,
  iOS home-screen redirect that returns to the same route, Google's error fragment shown only while
  a redirect is pending, a superseded silent request cannot settle Connect, no renewal once expired.
- `src/app/Settings.test.tsx` — privacy link; the Anthropic key field is masked text that keeps
  typing, and Paste fills it from the clipboard or says access was denied.
- `src/sw.test.ts` — the service worker handles app-shell navigations and leaves other pages
  (`privacy.html`) alone.
- `src/app/pwa.test.ts` — the service worker checks for an update on launch and on becoming visible.
- `src/app/App.test.tsx` — token renewal runs from pointerup and click, never pointerdown; the
  `theme-color` meta follows night mode.
- `src/app/RootPicker.test.tsx` — the root picker opens nested folders with breadcrumbs and picks
  one; a failed pick re-enables the buttons and shows the error.
- `src/app/boot.test.tsx` — the stored library renders while Google sign-in never finishes loading.
- `src/app/Onboarding.test.tsx` — the connect step says "Offline — Google sign-in unavailable",
  offers "Sign in with a redirect instead" and shows Google's sign-in error.
- `src/app/sw-plugin.test.ts` — the build plugin writes the asset list and cache version into
  `sw.js`.

What v2 added:

- `src/ink/InkLayer.test.tsx` — the live frame is filled with the outline the committed stroke
  gets; predicted samples are drawn live, never stored.
- `src/ink/PenStrip.test.tsx` — three widths and six colours with the active ones marked; a pick
  returns from the eraser to the pen; Select only with `withSelect`; the stacked layout.
- `src/app/settings.test.ts` — pen colour and width round-trip per device; values outside the
  presets fall back.
- `src/ink/Puck.test.tsx` — a tap flips Pen ⇄ Eraser, a long-press opens the palette, a drag
  along the edge moves the puck and is remembered, the puck and palette stay inside the host.
- `src/library/quotes.test.ts` — the quotation pick is deterministic; every quotation is short
  and attributed.
- `src/library/homeArt.test.ts` — the drawing without pictures; Drive pictures cached by version,
  dropped when removed, kept offline; a later pick wins over a slower one.
- `src/library/Hero.test.tsx` — drawing or cached picture, a picture switch on rotation, one
  quotation with its attribution, the band never shrinks.
- `src/app/index-html.test.ts` — no status-bar-style meta; `viewport-fit=cover` stays.
- `src/lib/order.test.ts` — order keys sort as strings, appends and prepends stay ordered, inserts
  between neighbours stay distinct, equal keys break by id.
- `src/drive/merge.test.ts` — notes merge per block and stroke by id with tombstones, keeps
  concurrent inserts, takes the newer background and name.
- `src/drive/library.test.ts` — notes files: create, locate by tag, merge before upload, offline
  queue, isolation from the sidecar, a sidecar edit never re-uploads the notes, a foreign or
  newer-schema file is never overwritten, a large file goes up resumably; home pictures recorded in
  the index.
- `src/notes/notesStore.test.ts` — blocks in order, split and join, typing as one undo step,
  image resize clamps, strokes, background, remote replace, its own undo stack.
- `src/notes/images.test.ts` — long edge 1600 px, JPEG at 0.82 or PNG with transparency, steps
  down to fit 1.5 MB, gives up below 400 px, never upscales.
- `src/notes/NotesSheet.test.tsx` — Enter, Backspace, title, images from paste, drop and picker,
  resize, delete, the p.N chip, background menu, ink in sheet units, the caret above the keyboard,
  a pointerdown outside the sheet drops the image selection.
- `src/pdf/Viewer.test.tsx` — an armed Snip takes the next box from the pen in the Pen tool, from a
  finger, and from a pen landing during a palm-started drag.
- `src/app/ui.test.ts` — Copy image writes a PNG `ClipboardItem` or downloads it.
- `src/app/Toolbar.test.tsx` — Snip arms with the "Drag a box" hint; the Paper · Both · Notes
  control offers Both only when allowed; no pen strip on touch; Undo acts on the given history.
- `src/app/Reader.test.tsx` — the notes file is read only when the sheet is shown; Both from
  700 px, and a stored Both on a narrow window shows the paper and keeps the setting; the divider
  stores the split; To notes adds the crop linked to its page and shows the sheet; Undo, ⌘Z and
  the document undo events act on the pane touched last; Copy as Markdown appends the Notes
  section; closing after a notes edit queues the notes and flushes; Notes and back returns the
  paper to where it was; a p.N chip in Notes shows the paper; the puck sits over the active pane.
- `src/annot/store.test.ts` — `documentUndo: false` ignores the document undo and redo events.
- `src/export/markdown.test.ts` — the Notes section lists text blocks in order and images as
  `(image, p.N)`, and is empty when there is nothing to list.

## Checked in headless Chrome (not on a device)

Against `dist/` served under `/marginalia/`, with a seeded library and cached `attention.pdf`:
onboarding shows the client id step on a fresh profile; library lists the paper with its badge;
the reader renders all 15 pages with the ink layer inside `.mg-page-inner`; a mouse text selection
shows the bar and a colour stores the highlight in IndexedDB; the sidebar lists it; at 390 px the
Ask panel is a bottom sheet and Esc closes it; the service worker registers, controls the page and
precaches the shell; no horizontal page scroll.

## Manual, on device

Not yet run; do these before calling v1 done.

### iPad with Apple Pencil (Safari home-screen app)

- [ ] The tool puck is visible without ever using the Pencil; long-press shows Pen / Eraser /
      Select and the colours.
- [ ] Pen draws; strokes have pressure-shaped ends and stay put after zooming.
- [ ] Resting the palm while drawing makes no marks and does not scroll.
- [ ] A finger always scrolls while the Pen tool is active (Finger draws off).
- [ ] Eraser removes whole strokes; Undo / Redo buttons and two-finger double-tap undo work.
- [ ] Select tool: Pencil drag selects text and shows the selection bar; Pen tool never selects.
- [ ] Long-press on a figure starts an area box; Ask sends the crop ("+ image" in the Ask panel).
- [ ] Sidebar and Ask panel sit beside the page in landscape and portrait (≥ 700 px).
- [ ] Night mode inverts pages but not images; "Invert images" inverts them too.

### iPhone (Safari home-screen app)

- [ ] Status bar and home indicator areas do not cover the toolbar or sheets (safe areas).
- [ ] Toolbar scrolls sideways to reach every button; nothing scrolls the whole page sideways.
- [ ] Sidebar and Ask open as bottom sheets; tapping an outline or highlight entry closes the
      sidebar sheet and scrolls the page.
- [ ] Long-press-drag selects text; the bar appears and disappears when the page scrolls.
- [ ] Note opens the inline textarea and the keyboard does not hide it.
- [ ] Copy and Copy as Markdown put text on the clipboard.
- [ ] Double-tap column zoom and pinch zoom; the last position is restored on reopen.
- [ ] Close a cached paper and open it again; it opens without an error.
- [ ] Settings → Paste fills the Anthropic key and Test key passes.

### Drive session and sync

- [ ] First connect shows the "unverified app" screen once; afterwards Connect is one tap.
- [ ] On iOS, if the popup is blocked the redirect flow returns to the app signed in.
- [ ] After the token expires (leave the app for over an hour), the library shows
      **Reconnect Drive**; reading and annotating still work; one tap reconnects and the queued
      sidecar uploads finish (sync status clears).
- [ ] Airplane mode: cached papers open and annotate; uncached papers show an error with Retry.
- [ ] A highlight made on the iPad appears on the laptop after its next sync, and vice versa.
- [ ] Mark a paper done on one device; the badge changes on the other after its next sync, and
      reopening the paper there lands at the last position.
- [ ] "Sign in with a redirect instead" returns to the same screen, signed in.
- [ ] A failed upload shows its message in the library header.
- [ ] Settings → Change root folder, Sign out, and Clear cached PDFs behave as labelled.
- [ ] Change root folder can open a nested folder and pick it.
- [ ] The Settings privacy link opens the privacy page.

### Laptop (Chrome)

- [ ] Draw latch: the viewer gets an accent border, the mouse draws, Esc or the button exits.
- [ ] The Snip button boxes an equation; the bar appears on release; the button disarms.
- [ ] ⌘/Ctrl-Z undo, ⇧⌘Z redo; Esc closes the bar, then the Ask panel, then the latch.
- [ ] An internal link (citation, figure ref) scrolls and shows "← back to p.N".
- [ ] Install as an app from the address bar; it opens standalone.
- [ ] Settings → Paste fills the Anthropic key and Test key passes.
- [ ] After `npm run deploy`, an open app shows **Update available — Reload** and reloads only
      when tapped.

### v2

- [ ] Remove the home-screen app and add it again; the top of the screen is solid with no blur on
      iPhone and iPad, and nothing sits under the status bar.
- [ ] Pencil strokes look the same before and after lift at every width and colour.
- [ ] The puck flips Pen ⇄ Eraser with a Pencil tap and opens the palette on long-press, drags
      along the edge, and stays put after relaunch.
- [ ] Snip works with the Pencil in the Pen tool, with a finger, and with the palm resting.
- [ ] Copy image pastes into Notes and Messages.
- [ ] To notes lands the crop on the sheet, and its p.N chip scrolls the paper.
- [ ] Both on iPad landscape with the divider; Both hidden on iPhone.
- [ ] Tapping empty sheet space raises the keyboard on iPhone and iPad.
- [ ] Typing near the bottom of the sheet keeps the caret above the keyboard.
- [ ] A note typed on the iPad appears on the laptop after sync.
- [ ] A sheet with five snips still syncs (resumable upload; confirm the upload finishes and the
      file appears in Drive).
- [ ] The home pictures from Drive appear on every device in grayscale, the iPad switches between
      the landscape and portrait pictures on rotation, and the drawing comes back when the files
      are removed.
- [ ] The quotation cartouche fits inside the band on the iPad.
