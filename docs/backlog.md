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

## Deferred from the v3 reviews (2026-11-04)

### Next

- Dragging a lasso selection moves only the dashed frame; the items follow at lift. Give the
  moved items a live transform (strokes live in shared layers, so this needs per-item layers or
  a temporary overlay) and autoscroll across pages.
- On the laptop, ⌘C of in-app ink cancels the system copy, so a screenshot left on the system
  clipboard wins every later ⌘V. Write a marker on in-app ⌘C/⌘X and prefer the clip when the
  marker is present. Verify ⌘V on an iPad with a hardware keyboard (Safari may send no `paste`
  event on a non-editable focus; a `beforepaste` handler may be needed).
- Esc should close the empty-space Paste offer; the offer should not open on every mouse click
  on empty paper; the image paste path should check the event target is inside the notebook.

### Ink and shapes

- Ink weight steps at the 8 × size threshold where fountain tapers switch on; a continuous ramp
  or pressure-shaped ends would remove the step. The first frozen chunk's start taper is fixed at
  freeze time. A gently curved open stroke snaps to a chord (plan rule). `trimOvershoot` can cut
  a figure-eight started at its crossing into an ellipse. The highlighter in straight-line mode
  fits the wobbly points on hold. The live highlighter draws above the ink on dark paper until
  commit. Scaled shapes are clamped per point.
- Per-contact eraser: no test for a strokes prop change mid-contact; the isotropic cache is keyed
  by id for the contact; piece order in a replace is insertion order; sub-pixel remnants.

### Tool menu

- The row panel on top/bottom docks is fixed at 56 px; the editor's max-height can clamp to 0 on
  very short hosts; wheel/keydown not stopped on the pill; contextmenu blocks paste in the HEX
  field; a stale HEX draft after an invalid entry; drawWheel ignores DPR; non-palette tools show
  the pen colour in the ring; ToolMenu.tsx is ~750 lines; settings are written on every slider
  move; the sanitised dock position is computed but not applied; the ring shows Black as pale at
  night even on white paper.

### Notebook

- Every zoom re-outlines every page (virtualise pages near the viewport); non-anchored pages
  jump 16·m·(k−1) px on pinch release; a plain scroll inside the 120 ms Ctrl-wheel window snaps
  back at commit; a two-finger touchstart in that window anchors on a stale scroll.
- `StrokeSvg` layer key redraws the whole page when the oldest stroke changes; every page carries
  an empty highlighter blend layer; To notes with the notebook hidden lands on page 1; one eraser
  swipe across several strokes needs one undo per stroke.
- Lasso: menu overlaps the selection in the "inside" placement; the frame's padding ring starts a
  new lasso; a lone selected text box moves only within its page; a cross-page drop can land items
  above the next page's top; 28 px lasso/text handles; a resting palm can tap thumbnails or drop
  text boxes; two quick menu taps zoom; a pinch starting on the frame moves the selection; the
  stale paste point after a wheel scroll; one document keydown listener per mounted layer; the
  empty-clip page add; text height zero in clips; paste order by kind; menu arrow keys.
- Text boxes: can grow past the page bottom; an empty box leaves two undo steps; `startEditing`
  sets contenteditable before `onEdit`; the selection frame is a later sibling.
- Thumbnails: outline cache keyed by stroke object; exact-centre drop untested; no before/after
  marker in the sheet layout; the column's thumbnail size is overridden from notebook.css.
- `Notebook.tsx` ~900 lines and `Reader.tsx` ~980 lines; `T` on the paper pane selects a tool
  paper pages ignore.

### Sync and storage

- A newer-schema notes remote is re-downloaded every sync while the local entry stays queued;
  `flushOne` still compares whole notebooks as JSON after an upload; no `onblocked` handler (a
  held connection hangs boot silently); the DB v3 bump makes the deploy one-way; the I1 perf test
  never reaches `tieKey`.

## Deferred from the v4 reviews (2026-11-15)

### Shell

- `settings.ts` import order; `VERDICT_SUFFIX` and `HOST_DEFAULT_URL` have no doc comments; the
  `boot.test.tsx` double-boot test relies on module state.

### Ask

- A selected page that alone is over the paper cap is still sent whole.
- The cached paper block differs per selected page only when truncated; a `<truncated>` marker
  after a later kept page can read as if that page was dropped.
- The first Ask on a long paper shows no progress while its pages load.
- Tests: the `Paper:` line, a missing selected page, kept pages 1–3, a `getAllText` failure then
  retry; the `+ image` line is covered only by the template test.

### Verdicts

- The skill's confidence and verdict criteria could be more concrete; the hash test has no known
  vector; `text` is shadowed in `skill.ts`.
- The note parser rejects a trailing `# comment`, reads YAML block-list topics as none, and
  `isVerdictNote` checks little; serialising writes an empty body as two newlines, topics are not
  quote-safe, and a quoted placeholder is an edge case.
- Every grading pass reads every paper's note; an automatic pass does not check grades already in
  flight, so it can repeat a manual grade; a stale `stop` from an older `startGrader` invalidates
  the newer one.
- The grader tests wait on fixed timer ticks; under full-suite load the restarted-grader test can
  fail and leave the queue blocked for the tests after it. Wait on conditions instead.
- Runner tests pin the fixture title as null, not the system-prompt suffix; abort, `ClaudeError`
  and destroy-on-reject are untested; no test for the queued-twice path.
- The busy chip has no role; a paper switch shows the old note for one frame; the Settings tests
  mock the whole grader module and restore mocks in a test body.
- The host's verdict-note check is a separate ten-line copy of the browser's parser rule.

### Drive

- A note that cannot be parsed blocks that paper's upload until the Drive file is removed.
- Note merges compare `generated` as strings; the resumable upload's content type is untested.
- A sidecar update from the map can be overwritten by an open reader store's next save.
- Exact `lastTouched` ties pick `pdfName` and colour labels by argument order; a multi-line gist
  quotes only its first line; the `mergeSidecars` doc comment; `setGist` leaving undo alone is
  not asserted.

### Map

- A new primary topic shifts every topic anchor; links are not sorted before the forces add up, so
  float order can drift; topic ids like `constructor` hit plain-object keys; pinned papers on the
  same spot jitter.
- The node fill is a hard-coded white at night; `map.css` loads before `app.css`, so `.mg-sheet`
  overrides the link sheet; hulls do not dim with filters.
- Touch: no hold cue and no `-webkit-touch-callout: none`; `pointers` is not cleared on
  `lostpointercapture`; right-button drags pan.
- Every move re-renders every layer; `MapView` is in the main bundle rather than loaded on the
  route.
- Duplicate links are allowed; `clampMap` uses 0–1000 while the layout uses 10–990; two quick
  topic adds use stale topics; the gist in the card and in the Verdict tab does not refresh when a
  sync changes it.
- The map card has its own verdict chip beside `src/verdict/VerdictChip`.
- Empty `topics.ids` hides the note's topics; duplicate topic ids double-count; the note's topics
  array is shared, not copied; `note: undefined` keys on edges.
- Untested: tie-break rules, hold-drag, pinch, wheel, hull double-tap, Neighbours, keyboard,
  Unpin, link phrases, `placeGraph`; tests mock the library instead of the fake IndexedDB;
  LinkSheet accessibility.

### Host

- `decodeURIComponent` on a bad path gives a 500; request bodies are not validated; page text is
  not escaped inside its tags; paper folder ids can collide; the token file's mode and atomic
  write, and `sessions.json`'s mode and write race; the jobs map grows; status events are noisy;
  subagent messages are not shown.
- Two `POST /sessions` for one paper at once leak the loser until shutdown; a drained event pump
  drops its session without `close()`; a dead session never reopened stays until the next open or
  shutdown; the verdict iterator's `return()` is not awaited; queued `turn_start` ordering.
- Fence: Grep patterns starting with `/` or `~` are denied; Glob brace patterns like `{..,x}`
  list names outside the root (reads stay fenced); a Write through a dangling symlink inside the
  paper folder is allowed; NotebookEdit picks `file_path ?? notebook_path`; about 13 `realpath`
  calls per check.
- `host.env` values keep their quotes; `--app` with a `/marginalia` path doubles the segment;
  `npm run host -- --flag` is not spelled out in `host/README.md`; `Skill` in `allowedTools` is
  deprecated for the `skills` option; no `engines` field; `interrupt()` swallows every error; the
  `--allow-bash` warning names only the API key, not the OAuth token.
- `onFailure: 'block'` on the fence hook has not been checked against a live CLI.
- Browser client: pairing from the link resets a custom host URL; `HostHttpError` is not
  exported; concurrent uploads of one paper.

### Terminal

- A message sent while the session is still opening is dropped silently.
- Enter is ignored while a turn runs, `/clear` included, so a hung turn needs the panel closed;
  `busy` stays set after a mid-turn connection flip until Esc.
- A mid-stream error shows the raw fetch message instead of the lost-connection line; turns that
  end in an error are not saved.
- `/model` is not confirmed and the header keeps the old model; a bare `/model` is sent as a
  message; the host's status spinner events are ignored.
- Command parsing lives in the component; each keystroke writes `value` twice.

### Reader

- The toolbar's Agent button repeats `openThread`'s exclusion and does not close the sidebar on a
  narrow screen, so sheets stack below 700 px; a second Agent click is ambiguous and the button
  has no pressed state.
- Opening a just-created agent thread from the sidebar remounts the terminal mid-turn.
- A dropped attachment cannot be re-attached by selecting the same passage; a press on the
  selection bar's own buttons clears it; with the terminal open, dismissing the bar on the PDF
  clears the chip.
- No tests for Ask and terminal excluding each other, a host state flip while the terminal is
  open, or `paper().pages` page tags.

### From the v4 final review

- Fallback grades after a host failure stamp the bundled skill hash and may show "older skill" at once.
- No timeout on a grade; a hung host run blocks the lane and disables the buttons for the session.
- The `uploaded` cache in `src/agent/host.ts` is never invalidated (404 after the host root changes until reload).
- `pairHost` sets `unreachable` before any probe, so fresh pairing reads "not reachable".
- The Settings host URL is free text; restrict it to 127.0.0.1/localhost.
- Agent threads export as "p.0" in Copy as Markdown.
- The plugin root is the whole repo; a dedicated plugin folder would be safer.
- The scanned-paper test checks the request shape, not the skill's "no text layer" rule in the prompt.
- Nothing tests that the browser and host skill hashes agree on the same file.
- `gradingSince` compares Drive modifiedTime, so an old PDF moved into the library later is never auto-graded; "first seen in the index" would match the intent better.
- Chrome Local Network Access vs the older Private Network Access preflight header: unverified across Chrome versions.
