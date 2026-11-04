# Marginalia v2 — design

Follow-up to `2026-11-02-marginalia-design.md`, which stays binding for everything not
changed here. v1 is installed on the owner's laptop, iPhone and iPad and works. v2 answers the
owner's first-week feedback, quoted:

> the pencil support isn't super good. when i draw using it, it first draws a thick [stroke]
> and then when i lift the pencil it becomes crisp. I would also like the app to support apple
> pencil pro, which i can double tap to switch between eraser and pencil, squeeze to change the
> tools and thickness and colour

> UI on ipad and iphone is cloudy at the top of the screen

> make the ui prettier by just having a grayscale diagram in the background, no colour,
> something like the image i have attached [a Japanese woodblock-style tiger over waves with a
> red sun and a vertical cartouche]. and instead of the words in the image, some inspiring words
> for reading

> a way to crop images to ask to the chat bot

> a page alongside the paper for me to take my notes on the paper. I should be able to type on
> it, write on it, paste images on it. This should mimic how the official notes app looks like on
> ipad, or goodnotes. I can just view the paper, just the notes, or both alongside. The notes page
> shouldn't have any background, just blank or grids, and white or dark.

## Goals

1. A Pencil stroke looks the same while it is being drawn as after the lift, and tools,
   thickness and colour are one Pencil tap away without reaching for the toolbar.
2. No blurred band at the top of the installed app on iOS 26.
3. A home screen that is calm and good-looking: one monochrome drawing, one line of words
   about reading, better type. Nothing louder.
4. A visible way, on every device, to box part of a page and ask Claude about it.
5. A notes sheet per paper, beside the paper or alone, that takes typing, Pencil writing and
   images, looks like Apple Notes, and syncs through Drive like the annotations do.

## Non-goals (v2)

Rich-text formatting in notes (bold, lists, headings beyond the title line), notes search,
freestanding notebooks not attached to a paper, handwriting recognition, lasso/shape tools,
Ask over the notes, exporting ink as images, a native app or wrapper, Pencil hover.

## Anti-goals

- Losing a note. The notes sheet obeys the v1 rule: every edit is in IndexedDB before any
  network call, and the sync merges, never overwrites.
- The on-screen keyboard covering what the owner is typing.
- A "Both" layout that leaves the paper unreadable (so it is not offered on phones).
- New modes a finger can get trapped in. The finger still only scrolls, taps and selects.
- A heavier app. No new runtime dependencies; the notes sheet lives in the lazy reader chunk.

## Platform facts that shape v2

- **Apple Pencil Pro squeeze and double-tap do not reach web content.** WebKit exposes Pencil
  input only as pointer events; `UIPencilInteraction` is native-only and nothing is announced
  for the web. The owner was told. The substitute is an on-screen control the Pencil can reach
  without leaving the page (the tool puck below). README says this plainly.
- **iOS 26.1 paints its Liquid Glass blur over the status bar of installed web apps that use
  `apple-mobile-web-app-status-bar-style=black-translucent`**, bleeding about 40 pt into the
  content. That is the "cloudy top". Dropping the meta gives a solid status bar in the
  `theme-color` colour (already night-aware) and `env(safe-area-inset-top)` becomes 0. iOS
  reads the meta at install time, so the owner removes and re-adds the app once; README and
  `docs/testing.md` say so. WebKit has reported `100vh` trouble without the meta; the shell uses
  `100dvh` and must be checked on a device, with `height: 100%` on `html, body` as the fallback.
- **The thick-then-crisp stroke** is ours: while the pen is down, `InkLayer` draws a plain
  round-capped polyline on a canvas; on lift it commits a `perfect-freehand` outline. The two
  look different.

## Feature 1 — Pencil

- **Live parity.** The live stroke is rendered from the same sample buffer with the same
  `perfect-freehand` options the committed stroke uses (`strokeOutlinePath`), filled on the live
  canvas once per animation frame. Predicted samples (`getPredictedEvents`) are appended for the
  live render only and never stored. The committed stroke must match the last live frame
  within a device pixel. Real Pencil pressure is used both live and committed.
- **Palette.** Pen / Eraser / Select (unchanged); three widths Fine · Medium · Thick; six
  colours (the current red, ink black, blue, green, orange, purple). Width and colour persist
  per device in Settings. Eraser stays whole-stroke.
- **Tool puck.** On touch devices, in the reader and on the notes sheet, a 44 px round
  floating control docked at the right edge, draggable along that edge, position remembered per
  device. It shows the active tool and colour. A tap (Pencil or finger) toggles Pen ⇄ Eraser.
  A long-press (≥ 350 ms) opens the palette as a popover anchored to the puck; a tap anywhere
  else closes it. On touch devices the toolbar's pen strip moves into this popover; the
  toolbar keeps Undo/Redo. The laptop keeps the strip in the toolbar and the Draw latch; no
  puck. In the Select tool the puck stays visible so the Pencil can return to Pen with one tap.

## Feature 2 — iOS status bar

Remove the `apple-mobile-web-app-status-bar-style` meta. Keep `viewport-fit=cover` (bottom
and side insets still matter). Check that nothing assumed `--safe-top > 0`; the toolbar's
`min-height` already degrades to `--tap + 4px`. Add the re-add-the-app step to README and the
device checklist.

## Feature 3 — Home

- **Hero band** at the top of the library (and behind onboarding): on phones about a third of
  the viewport, on wide screens 240–320 px tall, fading into the surface colour at its lower
  edge. The library list sits below the band on the plain surface, unchanged.
- **The owner's pictures.** The band shows an image the owner drops into the root papers
  folder in Drive (root folder only), with extension png, jpg, jpeg or webp, named
  `marginalia-home-landscape` or `marginalia-home-portrait`; the app picks by the viewport's
  orientation at the time (wider than tall → landscape) and switches when the device rotates.
  If only one of the two exists it is used for both orientations; a plain `marginalia-home`
  file is the generic fallback for either. `syncLibrary` records them in the index; the app
  downloads on demand, caches the bytes in IndexedDB, re-downloads when the Drive version
  changes, and shows the picture with `object-fit: cover` and `filter: grayscale(1)` (night
  mode also dims it slightly). One drop in Drive, every device. No settings picker.
- **Fallback drawing.** When no such file exists, the band shows a small built-in grayscale
  woodblock-style drawing (a great wave, sun, clouds, cranes, a distant mountain; inline SVG,
  about 7 KB, no text). Night mode inverts it through CSS. It is already drawn; no further art
  work is in scope.
- **Words.** Over the band, one short quotation about reading or study (≤ 14 words) with its
  attribution, in a vertical cartouche on wide screens and a horizontal strip on phones, set in
  the display serif. One quotation per launch, rotating through a curated list of at most 16,
  public domain or short attributed lines (Seneca, Bacon, Descartes, Erasmus, Thoreau, Emerson,
  Schopenhauer, Feynman and the like). The builder picks them.
- **Type.** Display serif stack for titles and the quotation:
  `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`. Body stays system sans.
  No web fonts. The reader is otherwise untouched.

## Feature 4 — Snip

A **Snip** toolbar button on every device (it replaces the laptop-only "Area select" label;
same mechanism underneath). Tapping it arms a one-shot box drag for whatever input comes next
(finger, mouse, or Pencil in any tool). While armed the button looks pressed and the toolbar
lead shows "Drag a box"; Esc or tapping again disarms. Releasing the box shows the selection
bar with: the colour dots (area highlight, as today) · **Ask** (opens Ask with the crop) ·
**Copy image** (PNG to the clipboard via `ClipboardItem`, falling back to a download) ·
**To notes** (appends the crop to the notes sheet as an image block linked to that page and
switches the layout to show the sheet). Long-press on non-text on touch keeps working as a
second way in.

## Feature 5 — Notes sheet

### Layout

- A segmented control in the toolbar: **Paper · Both · Notes**. Below 700 px only Paper ·
  Notes. In Both, the paper is on the left and the sheet on the right with a draggable divider
  (default half and half, remembered per device); fit-width zoom recomputes for the narrower
  paper pane. Each pane scrolls on its own. The last layout is remembered per device.
- One continuous sheet per paper, not pages. Minimum height is the pane height; it grows to the
  lowest block or stroke plus one pane height.

### Look

Apple Notes, not GoodNotes: a plain sheet in the paper colour (white; near-black in night
mode), no texture, generous margins, the first text block as a larger serif title. A small
menu at the top-right of the sheet picks the background: Blank · Grid · Dots · Lines; the
choice is stored in the notes file so every device agrees. An empty sheet shows a faint "Write
or type your notes".

### Content model

An ordered list of blocks plus an ink layer over the whole sheet.

- **Text block:** plain text paragraph (no formatting). Tap (finger, mouse, or Pencil in
  Select) places the caret; Enter makes a new block; Backspace at the start joins the previous
  block. Pasting rich text keeps only the text. The sheet scrolls so the caret stays above the
  on-screen keyboard.
- **Image block:** from paste, drag-drop, a "+ Image" button (file picker / photo library), or
  Snip. Stored downscaled, long edge ≤ 1600 px, JPEG at quality 0.82 (PNG when it has
  transparency), at most 1.5 MB each. Tap selects it (handles); drag a corner to resize (width
  in sheet units); delete with the block bar's Delete or Backspace while selected. A block that
  came from Snip carries a "p.N" chip that scrolls the paper to that page.
- **Ink:** the same tools, palette, puck and whole-stroke eraser as the page. Strokes are stored
  in sheet units — x and y both divided by the sheet width — so the sheet can grow without
  moving ink. Finger never draws (the v1 preference applies); the mouse Draw latch applies to
  the sheet too.
- **Block order** uses fractional order keys so two devices inserting in different places both
  survive a merge.
- **Undo/Redo:** the sheet has its own stack; the toolbar's Undo acts on the pane that was last
  touched. Cmd/Ctrl-Z inside a text block is the browser's text undo.

### Storage and sync

- A second companion file next to the PDF: `<pdf name>.marginalia-notes.json`, tagged
  `appProperties { marginalia: "notes", pdf: <pdfFileId> }`. Images live inside it as base64,
  so Drive holds one file per paper for notes and nothing else to manage.
- The same local-first, debounce, queue, locate, merge and pull machinery as the sidecar,
  generalised by kind (parameterise `library.ts`; do not duplicate it). Its own debounce and
  queue entry, so a highlight edit never re-uploads images.
- Merge: per block and per stroke by `id`, newest `updatedAt` wins, tombstones. Two devices
  editing the same text block: newest block wins whole. Background choice: newest wins.
- Export: "Copy as Markdown" appends a "Notes" section with the text blocks in order; image
  blocks appear as "(image, p.N)" lines.

## Interaction model additions

- The tool puck is the Pencil's fast path on touch devices: tap flips Pen ⇄ Eraser, long-press
  opens the palette. It never changes what a finger does.
- Snip arming applies to the next pointer of any type; it is one-shot and visibly armed.
- On the sheet, the Select tool means text caret and image selection; Pen and Eraser mean ink.
- Undo targets the last-touched pane.

## Sync model additions

- Companion files come in two kinds, `annotations` (the v1 sidecar) and `notes`; `syncLibrary`
  indexes and pulls both; `refreshSidecar`'s role exists for both kinds.
- The notes file is downloaded when the sheet is first shown for a paper, not on paper open,
  so opening a paper stays as fast as v1.

## What's left to the builder

The SVG composition and line weights, the quotation list, exact width presets, the puck's
visuals, grid and dot spacing, divider minimum widths, the image codec decision, the
placeholder wording, how the "p.N" chip looks, and the device-checklist wording.
