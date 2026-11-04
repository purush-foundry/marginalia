# Backlog

Items deferred from the v1 reviews, grouped by module. None loses data; each was ruled
"after the first device test". Add device-test findings here as they come in.

## Next

- One-tap **Trim margins** crop on the phone, derived from the page text bounds (spec feature).
- Items the on-device checklist in `docs/testing.md` turns up.

## Drive sync

- A pull during launch can merge a paper's sidecar between the Reader's `loadSidecar` and
  `refreshSidecar`; that open then misses the other device's state until reopened (one
  `getNode` round trip wide). Fix: on `settle(null)` reload the stored sidecar and
  `replaceFromRemote` if it changed.
- A queue entry dropped because its paper is outside the root leaves the record dirty with no
  queue entry; nothing uploads it until the next edit.
- In-flight GIS requests are matched oldest first; an interactive `popup_failed_to_open`
  answered while a silent request is listed waits for the 60 s timeout instead of redirecting.
- A pull failure sets the `error` state even when uploads in the same pass succeeded; a sidecar
  that cannot be parsed reports "N annotation download(s) failed" on every sync.
- `flushQueue` never clears the error state on a later success (the next `syncLibrary` does);
  no flush on the window `online` event (the 60 s sync covers it).
- `refreshSidecar` pending-label tie direction.
- Simultaneous first upload from two devices can create two sidecars; the If-Match update
  window is a README known limit.
- Eviction ordering, concurrent downloads of the same PDF, a trashed root folder,
  `setRootFolder` running outside the local lane, `library.ts` size.
- `evict`/`pdfCacheBytes` read every cached record to sum sizes; keep sizes in an index record.
- The unread → reading transition is lost if the reader closes before `refreshSidecar` settles.

## Viewer

- `openPdf` awaits every page size before the first paint; default to page 1's size and fill in.
- `reading.zoom` is an absolute scale shared across devices; a laptop zoom opens enormous on a
  phone. Make zoom per device, or fall back to fit-width when the viewport class differs.
- `/Rotate` pages unsupported; three-column pages interleave columns 2 and 3; fewer than three
  wide lines on one side interleave by y; a single-column page with a wide table may split.
- Desktop-Safari trackpad pinch; backward-drag column clamp; `PageView` memo; night-mode
  saturation round trip; `renderCrop` test; `iccUrl`; text-layer update after cancel; thin
  `penDrawing` tests for area select and double-tap.
- `replaceFromRemote` clears undo history on the first open after a cross-device edit.

## Ink

- Two-finger double-tap undo only works over a page, not in gaps or on the scroller.
- Thread markers need a finger tap while the Pencil is in pen or eraser mode.
- Erasures surviving cancel, simplify tolerance, swallowed-id leak.

## Ask (Claude)

- Stop uses abort; `gen.return` does not close the reader. Inline citation buttons are under
  44 px. Aborted turns are saved on unmount.

## Store and export

- `updatedAt`-stamp tests, sort tiebreaker, the exporter importing `sortHighlights` from the
  store.

## Shell

- PDF document leak when leaving mid-open; Esc with Settings open; Note-cancel on a fresh
  selection leaves a highlight; `ClientIdField` try/finally; Library badge `Promise.all`
  rejection; `connectDrive` out of `Settings.tsx`; `Reader.tsx` split.
- `pdfjs/` support files (cmaps, standard fonts, wasm) are not precached for offline use.
- `touch()` rewrites the whole PDF record on every cached open; store `openedAt` separately.

## Parked at the v2 final re-review

- The 44 px divider hit area covers 22 px of each pane for every pointer type: a Pencil stroke
  or selection starting within 22 px of the seam drags the divider, and on a laptop with classic
  scrollbars the paper's scrollbar sits under it. Keep 44 px only under `(pointer: coarse)` and
  ignore `pointerType === 'pen'` on the divider.
- The plan still describes the old narrow layout (Paper · Notes radios, `canLayoutBoth`), and the
  README says the lead shows "Drag a box" without the below-700 px exception.
- At 375 px (iPhone SE/mini) the Threads button sits 1 px into the toolbar scroll.
- `isSidecarDoc` checks only `highlights`; an index slot that already points at a notes file is
  not repaired (no client can create that state any more).

## Deferred from the v2 reviews (2026-11-03)

### Snip

- The download fallback revokes the object URL right after `click()`; WebKit may lose the
  blob and the toast still says "Image saved". Revoke later.
- An armed pen snip bypasses `penActivity`, so no palm window opens after it.
- Snip can be armed in the Notes layout and a selection bar survives the layout switch.
- The "Drag a box" hint is a `role=status` mounted with text (not announced); hidden below
  700 px where the lead is Back alone.
- Bar flex-wrap is an inline style; `onToNotes` missing from the bar's layout-effect deps.

### Home

- An orphan picture record can survive a superseded refresh; every refresh with an unchanged
  version mints a new object URL; a cached picture is not retried after coming back online
  while its id/version is unchanged; IndexedDB rejections escape the Hero effect.
- The quotation cartouche may overflow a 240 px band on a sideways phone; the onboarding hero is
  boxed, not edge to edge.

### Notes sync

- A newer-schema notes remote is re-downloaded every sync while the local entry stays queued.
- A trashed home-picture slot winner is not handed to the other file until a full walk.
- `sidecarRevision` is bumped per kind (a notes-only pull reloads badges); the isolation test
  proves only the annotations-first direction; `exceedsSimpleUpload` copies the body to measure.
- Every typing pause longer than 1.5 s uploads the whole notes file (can be several MB);
  confirm the resumable upload's final response carries `version`.
- A v1 tab left open on the laptop silently stops saving after the database upgrade.
- A background notes pull does not reach an open sheet until it is reopened (saving merges, so
  nothing is lost).
- v2 ignores a bad annotations record but does not repair an index slot that already points at
  a notes file (no client can create that state any more).

### Notebook images

- The 1.5 MB cap is on the blob, not the data URL (~2 MB base64); `decodeImage` is untested (no
  `createImageBitmap` in happy-dom).

### Reader

- Layout radiogroup lacks arrow keys; divider `aria-valuenow` is the stored ratio; no Home/End.
- Panes under 640 px total leave the notes pane under 320 px.
- `notesLayout`/`splitRatio` from storage are not sanitised.
- `Reader.tsx` is ~850 lines; `Divider`, `useMedia`, `clampSplit` could move out.
- `height: 100dvh` on the shell overrides the already-correct `inset: 0`.

### Notebook and lasso (v3 Phase B integration)

- A lone selected text box takes its own presses, so dragging it moves it within its page only;
  lasso it together with something else to carry it to another page.
- On a paper page a lasso cannot start inside a highlight's box; the press goes to the highlight.
- ⌘V pastes an image on the system clipboard ahead of the in-app clip, even one copied before
  the ink; marking the system clipboard on an in-app copy would let the newer one win.
- Dragging a lasso selection moves the dashed frame; the items follow at lift. A pages-level
  overlay that carries the items, with edge autoscroll, would preview a cross-page drag.
- A selection dropped on a page of a different width keeps its page-width coordinates, so it
  lands shifted by the width ratio.
- The keyboard on a Text-tool tap opens from a focus in the render after the tap; check on iOS
  (`docs/testing.md`, v3 Phase B) and move the focus into the tap handler if it does not open.
- `Notebook.tsx` is ~860 lines and `Reader.tsx` ~960; the lasso wiring, text placement, paste and `PaperLasso` could move out.
