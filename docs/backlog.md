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

- Pen width varies with pressure along the whole stroke; the spec wording is fixed-width
  strokes with pressure-shaped ends.
- Two-finger double-tap undo only works over a page, not in gaps or on the scroller.
- Thread markers need a finger tap while the Pencil is in pen or eraser mode.
- Eraser allocations, erasures surviving cancel, the dead `touch-action` base rule, simplify
  tolerance, swallowed-id leak.

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
