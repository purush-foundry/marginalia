# Marginalia v3 — design: ink feel and a GoodNotes-style notebook

Follow-up to the v1 and v2 designs, which stay binding for everything not changed here. The
owner has used v2 on all three devices. This round has two subjects only, quoted:

> the pencil doesn't have the problem it did before, but the writing is still not smooth. its
> rough. I want to mimic official apple notes and the apple pencil pro support as well.

> Have an agent look into the UI of GoodNotes for the note taking part, and replicate it.

The owner was told that Apple Pencil Pro squeeze and double-tap cannot reach a web app and
declined the native shell that would be needed, so the on-screen tool control stays the
substitute. Research inputs: the ink investigation (synthetic 240 Hz benchmark with
before/after renders, judged by eye) and the GoodNotes brief (help-centre articles, release
notes, user forums; details marked unverified there are decided here as our own values).

## Goals

1. Handwriting with the Pencil looks like Apple Notes' pen: smooth edges on slow strokes,
   even width, clean loops, no change on lift.
2. The notes pane becomes a GoodNotes-style notebook: fixed pages on a grey canvas, paper
   templates and colours, pen-first tools with slot presets, three eraser styles, a
   highlighter that reads as behind the ink, lasso with an object menu, draw-and-hold shapes,
   text boxes and images as movable objects, a thumbnail strip, pinch zoom.
3. The same pen, highlighter and eraser work on the paper's pages.
4. Nothing already written in v2 notes is lost: v2 documents convert into v3 pages.

## Non-goals (v3)

Pencil Pro squeeze, double-tap, barrel roll and haptics (native only; declined); Pencil hover
tooltips; pixel-level "precision" erasing; dashed or dotted stroke styles; image crop and
rotate; handwriting recognition, convert-to-text, AI; audio; tabs, multi-window; laser
pointer, tape, stickers, elements, zoom window; scribble-to-erase; Cornell template
(deferred); exporting ink as images.

## Anti-goals

- Any regression of the v1 input model: finger and mouse never enter a drawing mode by
  themselves; the Pencil owns the tool; palm rejection stays.
- A notebook that drops below the Pencil's frame rate on the iPad: the live stroke must stay
  at 120 Hz on long strokes.
- Losing a note: the local-first, merge-never-overwrite sync model is unchanged.
- A heavier app: no new runtime dependencies. The notebook stays inside the lazy reader
  chunk.

## Feature 1 — Ink feel

### Renderer (both surfaces, live and committed, same code)

Findings: the `Q`-curve path and the zoom-time rebuild are already right; the roughness comes
from Pencil jitter reaching the outline's edge directions (`streamline 0.4` lets it through,
and slow strokes sample at 0.3–0.5 px, the same size as the noise) and from raw pressure
changing the width at every sample. Removing the 0.5 px simplification alone makes it worse
(direction reversals become beads).

The renderer gains a smoothing stage before `perfect-freehand`, in this order:

1. Centred moving average on pressure, window 5.
2. Centripetal Catmull-Rom spline through the samples, resampled every 1 px of arc length,
   both ends kept.
3. Gaussian blur, σ = 1.5 px, on x, y and pressure, with the window narrowing at the ends so
   the endpoints stay put.

Then `getStroke` with `thinning 0.25, smoothing 0.65, streamline 0.35, last: true`, linear
easing, round caps, no taper, `simulatePressure` only when the stored pressure does not vary.
Stored points and `SIMPLIFY_PX = 0.5` are unchanged, so every stroke already saved renders
smoother with no migration. Fine · Medium · Thick keep their visual weight (ink area within
+7 %; the builder may scale size by 0.96 for parity). A pressure sample of 0 falls back to
the previous sample's pressure, not to 0.5.

### Performance

A 2,000-sample stroke costs about 10 ms per frame on a laptop and more on the iPad. The live
stroke therefore freezes its finished part in chunks of about 300 samples (overlapping 6 px;
ink is opaque with round caps, so seams do not show) and re-outlines only the open tail each
frame. The live canvas is sized to the visible part of the page or sheet, not the whole
surface, so it always draws at full device pixel ratio.

### Pen types, width in millimetres

Three pens, as GoodNotes: **Ball** (constant width: `thinning 0`), **Fountain** (the
renderer above with `thinning 0.35`, a start taper of 2 × size and an end taper of 3 × size),
**Brush** (`thinning 0.85`, tapers 4 × and 6 × size). Fountain is the default.

Width is a physical size. Each pen has three thickness slots, defaults 0.25 / 0.35 / 0.5 mm;
tapping the selected slot opens a slider 0.1–2.0 mm in 0.05 mm steps. Storage stays a
fraction of the page width; on notebook pages 1 mm = width / page width in mm (A4: 210); on a
PDF page the fraction is mm / (page width in pt × 0.3528), so a 0.35 mm pen is 0.35 mm on
every page. Existing v1/v2 strokes keep their stored fractions.

### Highlighter

A separate tool: flat, square-capped, constant width (slots 3 / 5 / 8 mm), 40 % alpha,
`mix-blend-mode: multiply` on white and yellow paper so black ink under it stays black; on
dark paper highlighter strokes render in a layer below the ink instead. "Draw straight line"
toggle in its settings. On PDF pages the ink highlighter is distinct from the v1 text
highlights (which stay as they are).

### Eraser

Three styles: **Stroke** (whole stroke, as today), **Segment** (removes the part of a stroke
within the eraser circle, splitting the stroke into the remaining pieces, each a new stroke
id; the original is tombstoned), and a **Pixel** style is a non-goal. Sizes 2 / 4 / 8 mm,
default the smallest. Filter checkboxes Pen · Highlighter (both on by default). "Auto-deselect"
switch: return to the previous tool on lift. An eraser circle follows the pointer while
erasing. The eraser never removes text boxes or images; those go through the lasso's menu.

### Draw-and-hold shapes

Pen or highlighter: if the pointer stays within 4 px for 500 ms at the end of a stroke, the
stroke is replaced by the best-fit **line, rectangle, ellipse, triangle or arrow** (chosen by a
closed-shape test and corner count; the builder picks the fit heuristics). While still held,
moving the pointer rescales and rotates the shape; lifting commits it as an ordinary stroke
(so it syncs, erases and lassos like any stroke). Off switch in the pen settings.

## Feature 2 — The notebook

### Pages

- Each paper has one notebook: an ordered list of fixed-size pages on a grey canvas
  (`#e9e9eb`; `#1c1c1e` in night mode), scrolled vertically, 16 px gaps, a faint drop shadow
  per page. Pages are centred when narrower than the pane.
- Default page **A4 portrait** (210 × 297 mm). Page sizes offered: A4, Letter, GoodNotes
  Standard (6.32 × 8.17 in), each portrait or landscape. Size is a per-page property; the
  template sheet offers "apply to all pages".
- **Templates** per page: Blank · Ruled narrow 6.4 mm · Ruled college 7.1 mm · Ruled wide
  8.7 mm · Grid 5 mm · Dots 5 mm. Rendered as SVG patterns so they stay crisp at any zoom.
  Line colour light blue-grey on white and yellow, 15 % white on dark.
- **Paper colours** per page: White · Yellow · Dark. Ink colours do not change with the
  paper; the night-mode Black→pale mapping from v2 applies only to the Dark paper.
- **Adding pages:** an **Add Page** button (Before · After · Last) in the notebook toolbar;
  pulling past the last page adds one that copies the last page's template; the first stroke
  or object on the last page adds a fresh page after it automatically. Pages can be deleted
  (tombstone) and reordered from the thumbnail strip.
- **Zoom and pan:** fit-width is the floor, 400 % the ceiling; two-finger pinch zooms around
  the pinch centre; double-tap with a finger toggles fit-width and 200 % at the tap; a finger
  always scrolls and pans; the mouse wheel scrolls, Ctrl/⌘-wheel zooms. Ink width is in page
  millimetres, so it scales with zoom.
- **Thumbnail strip:** toggled from the notebook toolbar; a left column of page thumbnails
  (about 160 px wide on the iPad and laptop, a bottom sheet on the phone), tap to jump,
  long-press-drag to reorder, with Delete and Duplicate on a long-press menu.

### Tools and the tool menu

Notebook toolbar (its own row at the top of the notes pane; the app toolbar keeps
Undo/Redo, the layout control and Snip): **Lasso · Pen · Highlighter · Eraser · Text · Image
· Add Page · Thumbnails · Template**. Keyboard on the laptop: L, P, H, E, T; ⌘Z / ⇧⌘Z.

The **tool menu** replaces the v2 puck and keeps its behaviour: a floating pill docked at the
right edge (draggable to any edge; position per device). Collapsed, it is one 44 px button
showing the active tool and colour: a tap flips Pen ⇄ Eraser (Select → Pen), a long-press
expands it. Expanded, it is a column: the tools, then the active tool's **three colour
slots** (plus a "+" slot, up to 12), then its **three thickness slots**. Tapping an already
selected slot opens its editor popover: the colour palette (12 presets), a hue/lightness
wheel and a HEX field; or the thickness slider. Long-press-drag reorders slots. Each tool
keeps its own palette, persisted per device in Settings. On the laptop the same pill exists
(the v2 toolbar strip goes away); the mouse Draw latch is replaced by "the mouse draws
whenever a drawing tool is selected and the pointer is over a page", with Lasso as the
no-draw tool and Esc returning to Lasso. The pen palette defaults: Black `#1c1c1a`, Blue
`#2f6fed`, Red `#d33a2c`; highlighter: Yellow `#ffe066`, Green `#9be38a`, Pink `#ffb3c6`.

### Objects: text boxes and images

- **Text tool:** tap on a page to drop a text box at the tap (default 60 % of the page
  width) and type; plain text, three sizes S / M / L (10 / 13 / 18 pt on the page), colour from
  the text tool's palette, display sans. Drag the box to move; side handles change its width
  (text reflows); double-tap an existing box to edit. The tool stays selected until changed.
- **Images:** the Image button (file picker / photo library), paste, drop, and Snip's To
  notes all place an image object centred on the current page at 50 % of the page width
  (Snip images keep their p.N chip). Corner handles scale proportionally; drag moves.
- Objects and strokes share one z-order per page in creation order; the lasso menu offers
  Bring to front / Send to back. Ink drawn after an image sits on top of it.

### Lasso

Freehand loop (dashed outline while drawing). Selects every stroke with at least 60 % of its
points inside the loop and every text box or image whose centre is inside; a tap on an
object with the Lasso also selects it. The selection shows a bounding box with corner scale
handles and a dashed outline; dragging inside moves it, across pages too. The **object menu**
pops above the selection as soon as the loop closes: Cut · Copy · Duplicate · Delete ·
Recolor (ink and text) · Front · Back. Copy/paste is in-app (and ⌘C/⌘V on the laptop); paste
lands at the pointer or centred on the visible page. Esc or a tap outside clears it.
Rectangular lasso mode is a toggle on the tool.

### Gestures and input

- Pen draws; finger scrolls, pans, pinches and taps; "Draw with finger" stays as the switch.
- Two-finger double-tap undo (exists), **three-finger double-tap redo** (new), on both
  surfaces.
- Pen hover (Pencil 2 on M2 iPads, Pencil Pro): if Safari delivers hover pointer events, show
  a dot of the current colour and size under the tip; verified on the device, off otherwise.

### Paper pages

The pen types, highlighter, eraser styles, draw-and-hold and the tool menu apply to drawing
on the PDF pages too. Lasso on the paper selects ink strokes only (not highlights or threads).

## Data model and sync

`NotesDoc` schema 2:

- `pages: NotePage[]` — `{ id, order (fractional key), size: { w, h } in mm, template,
  color, updatedAt, deleted }`.
- `strokes: NoteStroke[]` — `{ id, page, tool: 'pen' | 'highlighter', pen: 'ball' |
  'fountain' | 'brush', color, width (fraction of page width), points (x/w, y/w, pressure),
  z, updatedAt, deleted }`.
- `texts: TextObject[]` — `{ id, page, box (x, y, w in page-width units), text, size: 's' |
  'm' | 'l', color, z, updatedAt, deleted }`.
- `images: ImageObject[]` — `{ id, page, box, src, aspect, pdfPage?, z, updatedAt, deleted }`.
- `z` is a fractional order key per page shared by strokes and objects.
- Merge per item by id, newest `updatedAt` wins, tombstones; pages merge like items.
- **Conversion from schema 1** (v2's continuous sheet) on first load: strokes map into A4
  pages by y (sheet units × page width → page index and offset); text and image blocks stack
  from the top of page 1 in order with a fixed line height; the converted document is written
  as schema 2 and uploaded (a schema-1 remote is then superseded by the merge rule). A
  schema-2 remote is never read by a v2 client (the v2 guard already skips newer schemas).
- Paper-page strokes (`InkStroke` in the sidecar) gain optional `tool` and `pen` fields;
  absent means `pen`/`fountain` as before.
- Sync, tags (`notesFor`), queue and debounce are unchanged. Export lists text boxes and
  images per page in page order.

## Interaction model additions

- The tool menu pill is the single place tools, colours and thickness live on every device;
  the puck's tap-to-flip and long-press survive as its collapsed state.
- Tools are sticky; none reverts on its own except the eraser with Auto-deselect on.
- Lasso is the only tool under which a drawing pointer does not draw.
- A finger never draws unless "Draw with finger" is on; a mouse draws under any drawing tool.

## What's left to the builder

Shape-fit heuristics, the exact spline and blur implementation, chunk boundaries for the
frozen live stroke, the thumbnail renderer, popover visuals, the yellow paper tint, the
object-menu layout, hit-testing for the segment eraser, and the keyboard shortcut set beyond
the listed letters.

## Build order

Phase A, deployed first: the renderer, pen types and mm widths, highlighter, eraser styles,
pages with templates and colours, add page, zoom and pan, the tool menu pill, three-finger
redo, the schema-2 model with conversion. Phase B: lasso and object menu with z-order, text
boxes and images as objects, draw-and-hold, the thumbnail strip.
