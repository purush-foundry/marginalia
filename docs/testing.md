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
  store state only after an edit; a cached PDF pdf.js cannot open is replaced by a fresh download.
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
  `theme-color` meta and the night ink follow night mode.
- `src/app/RootPicker.test.tsx` — the root picker opens nested folders with breadcrumbs and picks
  one; a failed pick re-enables the buttons and shows the error.
- `src/app/boot.test.tsx` — the stored library renders while Google sign-in never finishes loading.
- `src/app/Onboarding.test.tsx` — the connect step says "Offline — Google sign-in unavailable",
  offers "Sign in with a redirect instead" and shows Google's sign-in error.
- `src/app/sw-plugin.test.ts` — the build plugin writes the asset list and cache version into
  `sw.js`.

What v2 added:

- `src/ink/InkLayer.test.tsx` — the live frame is filled with the outline the committed stroke
  gets; predicted samples are drawn live, never stored; Black strokes, live and committed, show in
  the pale ink at night and keep their stored colour.
- `src/library/quotes.test.ts` — the quotation pick is deterministic; every quotation is short
  and attributed.
- `src/library/homeArt.test.ts` — the drawing without pictures; Drive pictures cached by version,
  dropped when removed, kept offline; a later pick wins over a slower one.
- `src/library/Hero.test.tsx` — drawing or cached picture, a picture switch on rotation, one
  quotation with its attribution, the band never shrinks.
- `src/app/index-html.test.ts` — no status-bar-style meta; `viewport-fit=cover` stays.
- `src/lib/order.test.ts` — order keys sort as strings, appends and prepends stay ordered, inserts
  between neighbours stay distinct, equal keys break by id.
- ~~`src/drive/merge.test.ts` — notes merge per block and stroke by id with tombstones, keeps
  concurrent inserts, takes the newer background and name.~~ Superseded in v3: schema-1 notes are
  converted, then merged as notebooks (below).
- `src/drive/library.test.ts` — notes files: create, locate by tag, merge before upload, offline
  queue, isolation from the sidecar, a sidecar edit never re-uploads the notes, a foreign or
  newer-schema file is never overwritten, a large file goes up resumably; a notes file carries
  `notesFor` and no `pdf` key, so a v1 sidecar lookup never returns it; a stored or downloaded
  annotations body without `highlights` opens as an empty sidecar, is never merged and never
  uploaded; home pictures recorded in the index.
- `src/notes/images.test.ts` — long edge 1600 px, JPEG at 0.82 or PNG with transparency, steps
  down to fit 1.5 MB, gives up below 400 px, never upscales, closes the decoded image.
- `src/pdf/Viewer.test.tsx` — an armed Snip takes the next box from the pen in the Pen tool, from a
  finger, and from a pen landing during a palm-started drag.
- `src/app/ui.test.ts` — Copy image writes a PNG `ClipboardItem` or downloads it.
- `src/app/Toolbar.test.tsx` — Snip arms with the "Drag a box" hint; the Paper · Both · Notes
  control from 700 px; below it Back alone in the lead and a Notes toggle, with eight controls
  before Copy as Markdown; no Draw button on any device; Undo acts on the given history.
- `src/app/Reader.test.tsx` — ~~the notes file is read only when the sheet is shown~~ (superseded
  in v3); Both from 700 px, and a stored Both on a narrow window shows the paper and keeps the setting; at 390 px the
  toolbar has the Notes toggle and no title, at 1024 px the title and the radiogroup, and the
  toggle switches both ways; the divider is a 44 px target and stores the split; ~~To notes adds the crop linked to its page and shows the sheet~~ (superseded in v3); Undo, ⌘Z and
  the document undo events act on the pane touched last; Copy as Markdown appends the Notes
  section; closing after a notes edit queues the notes and flushes; Notes and back returns the
  paper to where it was; a p.N chip in Notes shows the paper; ~~the puck sits over the active
  pane~~ (superseded in v3 by the tool menu).
- `src/annot/store.test.ts` — `documentUndo: false` ignores the document undo and redo events.
- ~~`src/export/markdown.test.ts` — the Notes section lists text blocks in order and images as
  `(image, p.N)`, and is empty when there is nothing to list.~~ Superseded in v3 by
  `notebookToMarkdown` (below).

What v3 added:

- `src/ink/geometry.test.ts` — the smoothing keeps the wiggle on a slow curve under half a turn for
  every pen; the ball pen keeps its width; fountain and brush taper their ends.
- `src/ink/liveOutline.test.ts` — the live stroke freezes chunks of 300 samples and re-outlines
  only the tail; chunks overlap, only the ends taper, and predicted samples stay in the tail.
- `src/ink/InkLayer.test.tsx` — a pen reporting zero pressure keeps the last pressure; the live
  stroke is drawn in chunks on a canvas sized to the visible part of the page; the highlighter
  draws as one translucent path, under the ink on dark paper; the segment eraser splits strokes,
  keeps splitting its own pieces and hands one replace per stroke to the store on lift; eraser
  filters; Auto-deselect; a three-finger double tap redoes.
- `src/ink/erase.test.ts` — `splitStrokeAt` cuts a stroke where it enters and leaves the eraser
  circle, drops one-sample pieces, and returns null when nothing is hit.
- `src/ink/tools.test.ts` — tool switching records the previous tool; colour and width slots add,
  edit, move and clamp; millimetres to page fractions.
- `src/app/settings.test.ts` — tool palettes and settings round-trip per device; invalid stored
  fields fall back one by one; the dock edge and position persist.
- `src/ink/ToolMenu.test.tsx` — a tap flips Pen ⇄ Eraser, a long-press expands the tools, slots
  pick and edit, the pill docks to the nearest edge, panels and editors stay inside the host.
- `src/ink/color.test.ts` — the twelve presets, HSL to hex, hex normalisation and the colour wheel.
- `src/annot/store.test.ts` — `replaceStroke` tombstones the stroke and adds its pieces as one
  undo step.
- `src/notes/model.test.ts` — the empty notebook, schema-1 conversion into pages, and `pageLayers`
  grouping consecutive strokes between objects by z.
- `src/notes/notebookStore.test.ts` — pages, strokes, text and images with undo, the only live
  page is never deleted, Add Page copies the style, remote replace clears history.
- `src/drive/merge.test.ts` — notebooks merge pages, strokes, text and images by id; two devices
  converting the same v1 notes merge without duplicates; equal-time ties agree in either order
  and a large notebook with snips merges with its stored copy without stringifying points or src.
- `src/lib/idb.test.ts` — the version-3 upgrade copies every `notes` record into `notebooks` and
  leaves `notes` in place; a new database has no `notes` store.
- `src/drive/library.test.ts` — schema 1 and 2 notes files load, a schema-1 file converts and the
  conversion is uploaded, and queued edits from a v2 client merge into a schema-2 remote;
  notebooks are read from `notebooks`, never from what a v2 window writes to `notes`.
- `src/export/markdown.test.ts` — the Notes section lists each live page's text and images top to
  bottom, skipping empty pages but counting them.
- `src/notes/viewport.test.ts` — zoom clamps, page widths and the scroll that keeps a point still.
- `src/notes/paper.test.tsx` — ruled, grid and dot templates at their spacing, and the rule
  colour on dark paper.
- `src/notes/Notebook.test.tsx` — pages stack and centre; templates and colours; Add Page; the
  Template sheet; ink in page-width units and millimetres; pinch, double-tap and Ctrl-wheel zoom,
  which scales live and commits one zoom when the wheel stops; black text pale on dark paper;
  pull-to-add; a pinch while the pen is down does nothing; images, text and the p.N chip, which a
  pen tap opens without drawing; strokes above or below images by z; the tool row; segment-eraser
  pieces shown during the drag; a stroke on one page does not re-outline another.
- `src/app/Reader.test.tsx` — the notebook loads only when shown and offers Retry when it fails;
  To notes adds the crop to the current page at half width with its PDF page; Copy as Markdown
  appends the notebook; closing after an edit queues the notebook and flushes; the tool menu sits
  over the active pane on every device; the laptop opens in Lasso and a mouse drag selects text;
  L, P, H, E and Esc; paper ink in page millimetres and the highlighter under the ink at night.
- `src/app/Toolbar.test.tsx` — no Draw button on any device.
- `src/pdf/Viewer.test.tsx` — the scroller is the ink viewport.

v3 Phase B added:

- `src/ink/lasso.test.ts` — a stroke is selected at 60 % of its samples inside the loop and not at
  50 %; objects by box centre; rectangle loops with reversed corners; selection bounds.
- `src/notes/Lasso.test.tsx` — the dashed loop, the frame and the object menu above it (below it
  near the page top); Recolor swatches; move with a preview and one commit, and a jittered tap
  that does not move; corner scaling; rectangle mode; Esc and taps outside; ⌘C, ⌘X, Delete and
  Backspace, left alone in text fields and over a native text selection; ink only with text spans
  passed through; a finger taps but only draws the loop with Draw with finger, palm rejection and
  two-finger taps.
- `src/notes/clipboard.test.ts` — copied items are relative to the selection's top-left with its
  extent, and the page is left as it was.
- `src/notes/notebookStore.test.ts` — move (onto another page too), scale, recolor, front, back,
  remove, duplicate and paste are one undo step each; `src/annot/store.test.ts` — the paper ink's
  `updateStrokes`, `addStrokes` and `removeStrokes` likewise.
- `src/notes/TextBox.test.tsx` — a 60 % box at the tap, kept on the page; point size from the page
  width; typing, Enter, Esc and blur; external text updates keep the caret; side handles change the
  width with one commit; drag and double-tap to edit.
- `src/notes/ImageObject.test.tsx` — corner handles scale about the opposite corner with the aspect
  kept and a minimum width; drag moves; a tap selects and a pen press on an unselected image is not
  swallowed; the p.N chip.
- `src/ink/shapes.test.ts` — ellipse, rectangle, triangle (with overshoot), line and arrow fits; a
  scribble and short strokes fit nothing; `adjustShape` rotates and scales about the anchor.
  `src/ink/InkLayer.test.tsx` — a 500 ms hold snaps the live stroke, moving while held turns and
  scales it, a move restarts the timer, Draw and hold off keeps freehand, the highlighter snaps too.
- `src/notes/Thumbnails.test.tsx` — paper colour, ink and object boxes; a tap jumps; a long-press
  menu duplicates and deletes; long-press-drag reorders before or after a page; the sheet's close
  button.
- `src/notes/Notebook.test.tsx` — the bar order; the Text tool drops a 60 % box at the tap, edits
  it and stays on Text, a tap while editing only finishes the edit, an empty box is removed; a lasso
  move across a page boundary re-parents the selection to the page under the pointer, and undo puts
  it back; ⌘V pastes at the pointer, else centred on the current page, never in a text field or after
  a press in the other pane; Thumbnails opens a column beside the pages, a thumbnail tap scrolls to
  its page, and the phone sheet closes after the tap; a Lasso tap selects a text box (with its side
  handles) or an image, the Pen does not select images, and a double-tap on text does not zoom;
  under Lasso a selected text box drags on its own and a double-tap edits it; a wrapped text box's
  frame uses its measured height.
- `src/ink/ToolMenu.test.tsx` — the Text panel's colours, Add colour and S · M · L; the Pen's Draw
  and hold; the Lasso's Rectangular.
- `src/app/Reader.test.tsx` — a lasso on a PDF page selects ink only, moves it in page units, copies
  it into the notebook clipboard and deletes it with undo, while presses on text, links and inside a
  highlight's box (an area highlight, or a gap in a text highlight) pass through to the highlight
  tap; T picks Text, the notes pane's tool menu offers it, and Esc while typing keeps it.

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

- [ ] The tool menu is visible without ever using the Pencil; long-press shows the tools and the
      colours.
- [ ] Pen draws; strokes have pressure-shaped ends and stay put after zooming.
- [ ] Resting the palm while drawing makes no marks and does not scroll.
- [ ] A finger always scrolls while the Pen tool is active (Draw with finger off).
- [ ] Eraser removes whole strokes; Undo / Redo buttons and two-finger double-tap undo work.
- [ ] Lasso tool: Pencil drag selects text and shows the selection bar; Pen tool never selects.
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

- [ ] A paper opens in Lasso and a mouse drag selects text; P, H or E makes the mouse draw, and
      L or Esc stops it.
- [ ] The Snip button boxes an equation; the bar appears on release; the button disarms.
- [ ] ⌘/Ctrl-Z undo, ⇧⌘Z redo; Esc closes the bar, then the Ask panel, then returns to Lasso.
- [ ] An internal link (citation, figure ref) scrolls and shows "← back to p.N".
- [ ] Install as an app from the address bar; it opens standalone.
- [ ] Settings → Paste fills the Anthropic key and Test key passes.
- [ ] After `npm run deploy`, an open app shows **Update available — Reload** and reloads only
      when tapped.

### v2

- [ ] Remove the home-screen app and add it again; the top of the screen is solid with no blur on
      iPhone and iPad, and nothing sits under the status bar.
- [ ] Pencil strokes look the same before and after lift at every width and colour.
- [ ] Pencil strokes are as sharp while drawing as after lift on an iPad landscape page; if the
      live stroke is soft, report it. (The long notes sheet is gone in v3.)
- [ ] Black ink is visible at night, pale on the dark page, while drawing and after lift. (The
      dark notes sheet and the puck ring are gone in v3.)
- [ ] The app fills the screen with no gap at the bottom on iPhone and iPad after re-adding the
      home-screen app.
- ~~The puck flips Pen ⇄ Eraser with a Pencil tap and opens the palette on long-press, drags
  along the edge, and stays put after relaunch.~~ Superseded in v3 by the tool menu pill.
- [ ] Snip works with the Pencil in the Pen tool, with a finger, and with the palm resting.
- [ ] Copy image pastes into Notes and Messages.
- ~~To notes lands the crop on the sheet, and its p.N chip scrolls the paper.~~ Superseded in v3:
  the crop lands on a notebook page.
- [ ] Both on iPad landscape with the divider; Both hidden on iPhone, where the toolbar shows the
      Notes toggle and Night, Sidebar and Threads without scrolling.
- ~~Tapping empty sheet space raises the keyboard on iPhone and iPad.~~
- ~~Typing near the bottom of the sheet keeps the caret above the keyboard.~~
- ~~A note typed on the iPad appears on the laptop after sync.~~ The three above are superseded
  in v3: there is no sheet, and typing returns with text boxes in Phase B.
- [ ] A notebook with five snips still syncs (resumable upload; confirm the upload finishes and the
      file appears in Drive).
- [ ] The home pictures from Drive appear on every device in grayscale, the iPad switches between
      the landscape and portrait pictures on rotation, and the drawing comes back when the files
      are removed.
- [ ] The quotation cartouche fits inside the band on the iPad.

### v3

- [ ] Slow handwriting with the Pencil looks like the same words written in Apple Notes, at Fine,
      Medium and Thick for each of Ball, Fountain and Brush.
- [ ] The live stroke keeps up at 120 Hz on a long line: write a full page line without lifting.
- [ ] Live and lifted strokes look the same at the chunk seams.
- [ ] The segment eraser splits strokes, and Undo restores them.
- [ ] The highlighter leaves black ink black on white and yellow paper, and sits under the ink on
      dark paper and on night-mode PDF pages.
- [ ] Pinch zoom stays around the fingers; double-tap switches fit-width and 200 %; Ctrl-wheel
      zooms on the laptop.
- [ ] Pulling past the last notebook page adds one.
- [ ] A v2 notes file opens as pages on every device, without duplicates.
- [ ] The pill docks to each edge and stays there after relaunch.
- [ ] A three-finger double tap redoes.

### v3 Phase B

- [ ] Lasso with the Pencil on a notebook page: the loop, the frame, and the object menu near the
      top of a page (it should flip below the selection on page 1's top edge).
- [ ] Moving a selection across a page boundary lands it under the Pencil on the next page.
- [ ] A text box above the keyboard on the iPhone and on the iPad: tapping with Text opens the
      keyboard at once and typing keeps the caret in view.
- [ ] Draw-and-hold at 500 ms for each shape: line, rectangle, ellipse, triangle and arrow, with
      the Pen and the Highlighter; moving while held turns and scales it; the switch turns it off.
- [ ] Thumbnails: reorder by long-press-drag on the iPad and in the phone's bottom sheet.
- [ ] Pencil hover dot on an M2 iPad Pro or with a Pencil Pro; note whether Safari sends hover.
- [ ] Lasso on a PDF page: a Pencil drag on the text still selects text, a drag in the margin
      selects ink.
