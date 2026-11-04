# Marginalia v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pencil ink as smooth as Apple Notes, with three pens, a highlighter, segment erasing and widths in millimetres, and turn the notes pane into a GoodNotes-style notebook of fixed pages, with a tool pill, lasso, objects, shapes and thumbnails.

**Architecture:** Two phases. Phase A (Tasks 1–7) ships the renderer, the tool model and pill, the highlighter and eraser styles, the schema-2 notebook model with v1 conversion, and the paged notebook UI. Phase B (Tasks 8–12) adds the lasso, objects as movable items, draw-and-hold and thumbnails. Within a phase, modules are built on parallel worktrees behind the Interfaces below, and one integration task per phase wires them into `Reader.tsx`. The notes companion in `src/drive/library.ts` keeps its sync machinery and swaps its document type for schema 2.

**Tech Stack:** TypeScript, Vite 8, Preact 11, `@preact/signals` 2, `pdfjs-dist` 6.5, `perfect-freehand` 1.2; vitest + happy-dom with `preact/test-utils` `act` (no Testing Library).

**Spec:** `docs/superpowers/specs/2026-11-03-marginalia-v3-design.md`, extending `docs/superpowers/specs/2026-11-03-marginalia-v2-design.md` and `docs/superpowers/specs/2026-11-02-marginalia-design.md` (binding for everything v3 does not change).

## Global Constraints

- No new runtime dependencies. Comments are one line describing what the code does. Secrets only in IndexedDB and request headers; never in URLs, logs, sidecars, notes files, exports or source.
- Tool state belongs to the input: finger never draws unless "Draw with finger"; the Pencil owns the tool; a mouse draws under any drawing tool and never under Lasso; palm rejection stays.
- Every local edit is in IndexedDB before any network call; sync merges, never overwrites; notes tag `{ marginalia: 'notes', notesFor }`.
- Ink width is physical: stored as a fraction of the page width; 1 mm = width / page width in mm; PDF page width in mm = pt × 0.3528.
- The live stroke stays at 120 Hz on long strokes (chunked freeze); live and committed strokes are drawn by the same outline code.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Checks: `export PATH="$HOME/.local/node/bin:$PATH"; npx tsc -b && npx vitest run && npm run build`.
- Shared types live in `src/types.ts`; only Task 2 edits it in Phase A, and Phase B adds nothing to it. The notebook's schema-2 types live in `src/notes/model.ts`. Paper annotations stay normalised to the unrotated page (`Box`, x/y/w/h in [0, 1]); pages are 1-based. Notebook items are in page-width units: x and y both divided by the page width.
- Drive scopes exactly `https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file`. Sidecar `<pdf name without .pdf>.marginalia.json`, `appProperties { marginalia: "1", pdf }`; notes `<pdf name without .pdf>.marginalia-notes.json`, `appProperties { marginalia: "notes", notesFor }`, both in the PDF's folder.
- Touch targets ≥ 44 px. Everything works with mouse, touch and pen. No CSS framework, no icon fonts (inline SVG), no web fonts. The notebook lives in the lazy reader chunk.
- A task edits only the files its **Files** block names (plus its tests). `Reader.tsx` and `Toolbar.tsx` are edited by the phase's integration task only (7, 12). `README.md`, `docs/testing.md` and `docs/backlog.md` are edited by the integration tasks only; every task names the backlog items it closes, and its integration task deletes those lines.

## Order and ownership

| Task | Branch | After | Runs beside |
|------|--------|-------|-------------|
| 1 Ink renderer | `v3/ink-renderer` | — | 2, 5, 6 |
| 2 Tools model + settings | `v3/tools` | — | 1, 5, 6 |
| 3 Tool menu pill | `v3/tool-menu` | 2 | 4, 5, 6 |
| 4 Highlighter, eraser styles, redo | `v3/eraser` | 1, 2 | 3, 5, 6 |
| 5 Notebook model + sync | `v3/notebook-model` | — | 1–4 |
| 6 Notebook pages UI | `v3/notebook-ui` | 5 | 1–4 |
| 7 Phase A integration + docs | `v3/integrate-a` | 1–6 | — |
| 8 Lasso, object menu, z-order, clipboard | `v3/lasso` | Phase A on `main` | 9, 10, 11 |
| 9 Text boxes and images as objects | `v3/objects` | Phase A on `main` | 8, 10, 11 |
| 10 Draw-and-hold shapes | `v3/shapes` | Phase A on `main` | 8, 9, 11 |
| 11 Thumbnail strip | `v3/thumbnails` | Phase A on `main` | 8, 9, 10 |
| 12 Phase B integration + docs | `v3/integrate-b` | 8–11 | — |

Phase A branches start from `feat/v3-plan` (or the branch they depend on once merged); Phase A is merged and deployed before Phase B starts from `main`. Files shared in sequence: `src/ink/geometry.ts` (1 → 4 → 7), `src/ink/InkLayer.tsx` (1 → 4; Phase B: 10), `src/ink/tools.ts` and `src/app/settings.ts` (2 → 7), `src/annot/store.ts` (4; Phase B: 8), `src/drive/library.ts`, `src/drive/merge.ts`, `src/export/markdown.ts` (5 → 7), `src/notes/notebookStore.ts` (5; Phase B: 8), `src/notes/Notebook.tsx` (6 → 7; Phase B: 12), `src/ink/ToolMenu.tsx` (3; Phase B: 12), `src/app/icons.tsx` (3).

**v2 names and who removes them.** Task 2 adds the new tool model beside the v2 signals and removes nothing, so every v2 caller keeps compiling and behaving. Task 4 moves `InkLayer` (and its tests) off `penTool`, `penColor`, `penWidth` and `mouseDraws`. Task 7 deletes the rest: `PenTool`, `penTool`, `penColor`, `penWidth`, `mouseDraws`, `PEN_COLORS`, `PEN_WIDTHS`, `DEFAULT_PEN_COLOR`, `DEFAULT_PEN_WIDTH` (tools.ts); `AppSettings.penColor`, `penWidth`, `puckY`, `bindPenPalette` (settings.ts, boot.tsx); `PenStrip.tsx`, `Puck.tsx`, `puck.css`, `NotesSheet.tsx`, `blocks.tsx`, `SheetInk.tsx`, `notesStore.ts`, `notes.css` and their tests; the retired `loadNotes`/`saveNotes`/`refreshNotes` stubs and `notesToMarkdown`; and it updates the remaining callers (`Reader.tsx`, `Toolbar.tsx`, `Viewer.test.tsx`, `Reader.test.tsx`, `Toolbar.test.tsx`).

## Review Focus

1. A device still running v2 from its cached service worker edits notes after another device has uploaded schema 2. When it updates, its queued schema-1 edits must convert and merge into the schema-2 file, losing nothing and duplicating nothing. (Task 5: `queued schema-1 notes edits from a v2 client merge into a schema-2 remote after the update`)
2. Two devices open the same v2 notes and each converts it on first load. The merge must hold one copy of every page, stroke, text and image. (Task 5: `two devices converting the same schema-1 notes merge without duplicate pages or items`)
3. Dragging the segment eraser along a stroke it has already split. The pieces must keep splitting, the original must never come back, and no one-sample dots may be left. (Task 4: `dragging the segment eraser along a stroke keeps splitting the pieces it made`)
4. A palm or two fingers land on the notebook while the Pencil is drawing. Nothing may zoom or pan, and the stroke must go on. (Task 6: `a two-finger pinch while the pen is down neither zooms nor ends the stroke`)
5. On the laptop, now that the mouse draws under any drawing tool, opening a paper must still let a mouse drag select text and make a highlight. (Task 7: `on the laptop the reader opens in Lasso and a mouse drag selects text`)

---

# Phase A

### Task 1: Ink renderer

**Files:**
- Modify: `src/ink/geometry.ts` (smoothing stage, pen option sets, optional `pen` and `ends`)
- Create: `src/ink/liveOutline.ts`
- Modify: `src/ink/InkLayer.tsx` (pressure fallback, chunked live frame, visible-area canvas)
- Create: `src/ink/testStrokes.ts` (test fixtures: the bench's slow-curve case and turning measure)
- Test: `src/ink/geometry.test.ts`, `src/ink/liveOutline.test.ts`, `src/ink/InkLayer.test.tsx`

**Interfaces:**
- Consumes: nothing new. Keeps the v2 tool signals (`penTool`, `penColor`, `penWidth`, `mouseDraws`); Task 4 moves off them.
- Produces:

```ts
// src/ink/geometry.ts
export type PenStyle = 'ball' | 'fountain' | 'brush'   // same union as types.ts (Task 2); Task 7 swaps it for the import
/** Thinning and taper lengths (multiples of the size) per pen. */
export const PEN_STYLES: Record<PenStyle, { thinning: number; startTaper: number; endTaper: number }>
//   ball { 0, 0, 0 } · fountain { 0.35, 2, 3 } · brush { 0.85, 4, 6 }
export function smoothStrokePoints(points: number[]): number[][]
export function strokeOutlinePath(points: number[], widthPx: number, pressureIsReal: boolean,
  pen: PenStyle = 'fountain', ends: { start: boolean; end: boolean } = { start: true, end: true }): string
export function inkOutlinePath(points: number[], width: number, cssW: number, cssH: number, pen: PenStyle = 'fountain'): string
// pressureVaries, strokeHitsPoint, simplifyPoints: unchanged

// src/ink/liveOutline.ts
export const LIVE_CHUNK_SAMPLES = 300
export const LIVE_CHUNK_OVERLAP_PX = 6
export interface LiveOutline {
  /** Points: the whole simplified stroke so far, CSS px, flat [x, y, p]; extra: predicted samples, outlined with the tail only. */
  update(points: number[], extra?: number[]): { frozen: readonly string[]; tail: string }
}
export function createLiveOutline(outline: (points: number[], ends: { start: boolean; end: boolean }) => string): LiveOutline

// src/ink/InkLayer.tsx
/** Attribute on the scroller whose rect bounds the live canvas. */
export const INK_VIEWPORT_ATTR = 'data-ink-viewport'
// InkLayerProps unchanged
```

`getStroke` options for every pen: `{ size: widthPx, thinning, smoothing: 0.65, streamline: 0.35, last: true, easing: (t) => t, simulatePressure: !pressureIsReal, start: { cap: true, taper: ends.start ? startTaper * widthPx : 0 }, end: { cap: true, taper: ends.end ? endTaper * widthPx : 0 } }`, fed `smoothStrokePoints(points)`. `SIMPLIFY_PX = 0.5` and stored points are unchanged.

- [ ] **Step 1: Write the failing renderer tests**

`src/ink/testStrokes.ts` transcribes `rng`, `dense` and `sampleAtRate` from `/home/purush/marginalia-wt/inkspike/bench/cases.ts`, plus `turning` from `/home/purush/marginalia-wt/inkspike/bench/sweep.ts`, and exports `slowCurveSamples(noise: number): { x: number; y: number; p: number }[]`. This is the bench's case (d): `dense((t) => [40 + 220t, 60 + 22 sin 2πt − 8 sin 5πt])`, 240 Hz, speed 70 px/s, seed 4, jitter 0.3, pressure base 0.4. It also exports `turning(d: string): number`.

```ts
// src/ink/geometry.test.ts
const PAGE = { w: 800, h: 1035 }
const stored = (noise: number) => simplifyPoints(slowCurveSamples(noise).flatMap((s) => [s.x / PAGE.w, s.y / PAGE.h, s.p]), 0.5 / PAGE.w)
const wiggle = (pen: PenStyle) =>
  turning(inkOutlinePath(stored(1), 0.004, PAGE.w, PAGE.h, pen)) - turning(inkOutlinePath(stored(0), 0.004, PAGE.w, PAGE.h, pen))

test.each(['ball', 'fountain', 'brush'] as const)('the slow curve wiggles under half a turn with the %s pen', (pen) => {
  expect(wiggle(pen)).toBeLessThan(0.5)        // v2's renderer scores 3.17 on this case
})
test('a ball stroke keeps one width whatever the pressure', ...)
  // horizontal 200 px line, pressures 0.2 vs 0.9: outline height at x = 100 equal within 0.1 px; height at x = 5 equals x = 100 within 0.1 px
test('fountain and brush taper their ends, and the brush swings more with pressure', ...)
  // fountain height at x = 2 < 0.6 × height at x = 100; brush (0.9 − 0.2 pressure) height ratio > fountain's
test('strokeOutlinePath without end tapers leaves full-width ends', ...)
  // fountain, ends { start: false, end: false }: height at x = 2 ≥ 0.9 × height at x = 100
```

```ts
// src/ink/liveOutline.test.ts — the outline argument is a spy returning `${n}:${ends.start}:${ends.end}` (n = sample count)
test('freezes chunks of 300 samples and re-outlines only the tail', () => {
  // feed a 1,000-sample stroke 1 px apart, one sample per update
  // → frozen.length === 3; every frozen string is unchanged by later updates;
  //   no spy call gets more than LIVE_CHUNK_SAMPLES + 1 samples
})
test('only the first chunk keeps the start taper and only the tail gets the end taper', ...)
test('consecutive chunks overlap by at least 6 px of arc length', ...)
test('predicted samples go into the tail and never into a frozen chunk', ...)
```

`InkLayer.test.tsx`, in `describe('InkLayer live render')` (stub `Path2D` and `getContext` as v2 does, and restore them in `afterEach`):

```tsx
it('a pressure-0 sample takes the previous sample\'s pressure', ...)
  // pen down p 0.3, coalesced moves p 0.6, p 0, p 0.4 (20 px apart) → stored pressures [0.3, 0.6, 0.6, 0.4]; a first sample at p 0 stores 0.5
it('a 1,000-sample live stroke fills its frozen chunks and the tail, and commits the unchunked outline', ...)
  // 1,000 coalesced samples 1 px apart in rows across the 200 × 400 page; flush one frame → ctx.fill called 4 times (3 chunks + tail);
  // pointerup → svg path d === inkOutlinePath(added[0].points, 0.004, 200, 400)
it('sizes the live canvas to the visible part of the page at the device pixel ratio', ...)
  // layer inside div[data-ink-viewport] with rect (0, 0, 300, 200); layer rect (-50, -100, 400, 800); devicePixelRatio 2
  // → canvas style left 50px, top 100px, width 300px, height 200px; canvas.width 600, height 400; setTransform(2, 0, 0, 2, -100, -200)
it('pressureVaries comes from the stored samples, not the predicted ones', ...)
  // constant stored pressure 0.5 and a predicted sample at 0.9 → the tail Path2D's d equals
  // strokeOutlinePath([...storedPx, ...predictedPx], 0.004 × 200, false, 'fountain', { start: true, end: true })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ink`
Expected: FAIL. `./testStrokes` and `./liveOutline` are missing, `inkOutlinePath` takes no pen, and the canvas covers the whole page.

- [ ] **Step 3: Implement the renderer**

Transcribe `toTriples` (centred pressure average, window 5), `catmullRom`, `resample` (1 px) and `blur` (σ 1.5 px) from `/home/purush/marginalia-wt/inkspike/src/ink/geometry.ts`, export `smoothStrokePoints`, and add `PEN_STYLES` with the options above. Path formatting (`Q` midpoints, two decimals) is unchanged.

- [ ] **Step 4: Implement `createLiveOutline`**

The chunk boundary rule is the only part the tests leave open:

```
tailStart = 0, frozen = []
on update(points, extra):
  n = sample count of points
  while n - tailStart > LIVE_CHUNK_SAMPLES:
    end = tailStart + LIVE_CHUNK_SAMPLES
    frozen.push(outline(samples tailStart..end, { start: tailStart === 0, end: false }))
    k = end, arc = 0
    while k > tailStart + 1 and arc < LIVE_CHUNK_OVERLAP_PX: arc += distance(k - 1, k); k--
    tailStart = k
  tail = outline(samples tailStart..n-1 then extra, { start: tailStart === 0, end: true })
```

Samples before the last one never change as the stroke grows (`simplifyPoints` decides each sample from earlier ones only), so frozen chunks stay valid.

- [ ] **Step 5: Implement the live frame and the canvas in `InkLayer`**

`sampleOf` uses the previous stored sample's pressure when a pen sample reports 0, and 0.5 for a first sample of 0. `LiveStroke` gains `outline: LiveOutline`, `chunks: Path2D[]` (one per frozen string, created once) and `real: boolean` (`pressureVaries` of the stored samples, recomputed per frame). `frame()` converts `simplifyPoints(s.points, SIMPLIFY_PX / cssW)` to CSS px, calls `s.outline.update(px, predictedPx)`, appends new frozen strings to `chunks`, clears, then fills each chunk and the tail. `openCanvas` intersects `root.getBoundingClientRect()` with the closest `[data-ink-viewport]` ancestor's rect (else `0, 0, innerWidth, innerHeight`). It places the canvas at that offset with that CSS size, sets `width/height` to the size × `devicePixelRatio`, and sets `setTransform(dpr, 0, 0, dpr, -offX × dpr, -offY × dpr)`. `LIVE_CANVAS_MAX_PIXELS` goes away. The canvas position and size are set inline, which overrides the `width/height: 100%` rule in `ink.css`.

- [ ] **Step 6: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass, every existing InkLayer test included.

- [ ] **Step 7: Commit**

```bash
git add src/ink
git commit -m "ink: spline and Gaussian smoothing before the outline, three pen option sets, chunked live stroke on a visible-area canvas" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Closes backlog: "Pen width varies with pressure along the whole stroke" (Ball is constant width); "The getContext spy in InkLayer.test.tsx is never restored"; "The predicted tail can flip pressureVaries for the live frame only"; "The live canvas covers the whole page or sheet under a 4 Mpx cap".

---

### Task 2: Tools model and settings

**Files:**
- Modify: `src/types.ts` (`PenStyle`; `InkStroke.tool` optional `'pen' | 'highlighter'`, `InkStroke.pen?`)
- Modify: `src/ink/tools.ts` (new model beside the v2 signals)
- Modify: `src/app/settings.ts` (new persisted fields, sanitiser, `bindToolSettings`)
- Modify: `src/app/boot.tsx` (call `bindToolSettings()` after `bindPenPalette()`)
- Test: `src/ink/tools.test.ts` (new), `src/app/settings.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:

```ts
// src/types.ts
export type PenStyle = 'ball' | 'fountain' | 'brush'
// InkStroke: `tool?: 'pen' | 'highlighter'` (absent = pen; replaces the required 'pen' | 'marker'), `pen?: PenStyle` (absent = fountain)

// src/ink/tools.ts (all v2 exports stay as they are)
export type { PenStyle } from '../types'
export type Tool = 'lasso' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'image'
export type PaletteTool = 'pen' | 'highlighter' | 'text'
export interface ToolPalette { colors: string[]; widthsMm: number[]; colorIndex: number; widthIndex: number }
export interface PenSettings { style: PenStyle; drawAndHold: boolean }
export interface HighlighterSettings { straight: boolean }
export interface EraserSettings { style: 'stroke' | 'segment'; sizeMm: 2 | 4 | 8; erasePen: boolean; eraseHighlighter: boolean; autoDeselect: boolean }
export interface LassoSettings { rect: boolean }
export type TextSize = 's' | 'm' | 'l'

export const DEFAULT_PALETTES: Record<PaletteTool, ToolPalette>
//   pen { ['#1c1c1a', '#2f6fed', '#d33a2c'], [0.25, 0.35, 0.5], 0, 1 }
//   highlighter { ['#ffe066', '#9be38a', '#ffb3c6'], [3, 5, 8], 0, 1 }
//   text { ['#1c1c1a', '#2f6fed', '#d33a2c'], [], 0, 0 }
export const DEFAULT_PEN_SETTINGS: PenSettings          // { style: 'fountain', drawAndHold: true }
export const DEFAULT_HIGHLIGHTER_SETTINGS: HighlighterSettings   // { straight: false }
export const DEFAULT_ERASER_SETTINGS: EraserSettings    // { style: 'stroke', sizeMm: 2, erasePen: true, eraseHighlighter: true, autoDeselect: false }
export const DEFAULT_LASSO_SETTINGS: LassoSettings      // { rect: false }
export const MAX_COLOR_SLOTS = 12
export const WIDTH_RANGE_MM: Record<'pen' | 'highlighter', { min: number; max: number; step: number }>
//   pen { 0.1, 2, 0.05 } · highlighter { 1, 15, 0.5 }
export const MM_PER_PT = 0.3528
export const A4_WIDTH_MM = 210

export const tool: Signal<Tool>                 // default 'pen'
export const previousTool: Signal<Tool>         // default 'pen'
export const palettes: Signal<Record<PaletteTool, ToolPalette>>
export const penSettings: Signal<PenSettings>
export const highlighterSettings: Signal<HighlighterSettings>
export const eraserSettings: Signal<EraserSettings>
export const lassoSettings: Signal<LassoSettings>
export const textSize: Signal<TextSize>         // default 'm'

export function setTool(next: Tool): void       // a change records the outgoing tool in previousTool
export function isInkTool(t: Tool): t is 'pen' | 'highlighter' | 'eraser'
export function activeColor(t: PaletteTool): string
export function activeWidthMm(t: 'pen' | 'highlighter'): number
export function selectColor(t: PaletteTool, index: number): void
export function setColor(t: PaletteTool, index: number, hex: string): void
export function addColorSlot(t: PaletteTool, hex: string): boolean       // appends and selects; false at MAX_COLOR_SLOTS
export function moveColorSlot(t: PaletteTool, from: number, to: number): void   // the selected slot stays selected
export function selectWidth(t: 'pen' | 'highlighter', index: number): void
export function setWidthMm(t: 'pen' | 'highlighter', index: number, mm: number): void   // clamped to the range, rounded to its step
export function moveWidthSlot(t: 'pen' | 'highlighter', from: number, to: number): void
export function pageWidthMm(ptWidth: number): number          // pt × MM_PER_PT
export function mmToFraction(mm: number, pageWidthMm: number): number   // mm / pageWidthMm
export function inkDisplayColor(color: string, dark: boolean = nightInk.value): string   // Black → pale when dark

// src/app/settings.ts
export type DockEdge = 'left' | 'right' | 'top' | 'bottom'
// AppSettings gains: palettes, penSettings, highlighterSettings, eraserSettings, lassoSettings, textSize,
//   toolDock: { edge: DockEdge; at: number }   (default { edge: 'right', at: 0.6 })
export function sanitizeToolSettings(stored: Partial<AppSettings>): Pick<AppSettings,
  'palettes' | 'penSettings' | 'highlighterSettings' | 'eraserSettings' | 'lassoSettings' | 'textSize' | 'toolDock'>
export function bindToolSettings(): () => void   // copies sanitised stored values into the signals, saves them back on change (untracked); returns the unsubscribe
```

A palette is valid when it has 1–12 colours matching `/^#[0-9a-f]{6}$/i`, exactly three widths inside the tool's range (none for text), and indexes in range. An invalid field falls back to its default on its own; `toolDock.at` is clamped to [0, 1], and NaN falls back.

- [ ] **Step 1: Write the failing tests**

```ts
// src/ink/tools.test.ts
test('pen, highlighter, text and eraser start with the spec defaults', ...)   // the values in Interfaces; activeWidthMm('pen') 0.35, activeColor('highlighter') '#ffe066'
test('setTool remembers the tool it leaves', () => {
  setTool('pen'); setTool('eraser')
  expect(previousTool.value).toBe('pen')
  setTool('eraser')
  expect(previousTool.value).toBe('pen')
})
test('a colour slot can be added up to 12, and moving a slot keeps the selection on it', ...)
  // addColorSlot ×9 → 12 colours, the 10th call returns false; select 0, moveColorSlot(0, 2) → colors[2] '#1c1c1a', colorIndex 2
test('thickness is clamped to the tool range in its steps', ...)
  // setWidthMm('pen', 0, 3) → 2; setWidthMm('pen', 0, 0.333) → 0.35; setWidthMm('highlighter', 0, 0.2) → 1
test('a 0.35 mm pen is 0.35 mm on A4 and on a Letter PDF page', () => {
  expect(mmToFraction(0.35, A4_WIDTH_MM)).toBeCloseTo(0.35 / 210, 10)
  expect(pageWidthMm(612)).toBeCloseTo(215.9136, 4)
  expect(mmToFraction(0.35, pageWidthMm(612)) * 612 * MM_PER_PT).toBeCloseTo(0.35, 10)
})
test('isInkTool is true for pen, highlighter and eraser only', ...)

// src/app/settings.test.ts (signals imported after vi.resetModules(), as the v2 pen test does)
test('tool palettes and settings round-trip per device', ...)
  // stored palettes.pen { colors: ['#000000'], widthsMm: [0.3, 0.4, 0.6], colorIndex: 0, widthIndex: 2 } → after loadSettings + bindToolSettings, palettes.value.pen equals it;
  // setColor('pen', 0, '#123456') → the stored palettes.pen.colors[0] is '#123456'
test('malformed stored tool settings fall back field by field', ...)
  // pen { colors: ['nope'] }, eraser sizeMm 5, toolDock { edge: 'middle', at: NaN } → DEFAULT_PALETTES.pen, sizeMm 2, toolDock { 'right', 0.6 }; highlighter left valid stays
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ink/tools.test.ts src/app/settings.test.ts`
Expected: FAIL. `setTool`, `DEFAULT_PALETTES` and `bindToolSettings` are not exported.

- [ ] **Step 3: Implement the types, the model and the settings**

Palette operations replace `palettes.value` with a new object (never mutate). `bindToolSettings` calls `saveSettings` inside `untracked` so the effect tracks only the tool signals.

- [ ] **Step 4: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass; every v2 test is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/ink/tools.ts src/ink/tools.test.ts src/app/settings.ts src/app/settings.test.ts src/app/boot.tsx
git commit -m "ink: tool model with per-tool palettes in millimetres, eraser, pen and highlighter settings persisted per device" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Closes backlog: "`bindPenPalette` tracks `settings` through `saveSettings`; wrap it in `untracked`" (its replacement does; Task 7 deletes the original); "`puckY` from storage is not sanitised" (the dock replaces it, sanitised).

---

### Task 3: Tool menu pill

**Files:**
- Create: `src/ink/ToolMenu.tsx`, `src/ink/toolmenu.css`, `src/ink/color.ts`
- Modify: `src/app/icons.tsx` (icons `lasso`, `highlighter`, `text`, `image`, `plus`)
- Test: `src/ink/ToolMenu.test.tsx`, `src/ink/color.test.ts`

**Interfaces:**
- Consumes (Task 2): `Tool`, `tool`, `previousTool`, `setTool`, `palettes`, `penSettings`, `highlighterSettings`, `eraserSettings`, `activeColor`, `activeWidthMm`, `selectColor`, `setColor`, `addColorSlot`, `moveColorSlot`, `selectWidth`, `setWidthMm`, `moveWidthSlot`, `MAX_COLOR_SLOTS`, `WIDTH_RANGE_MM`, `inkDisplayColor`; `settings`, `saveSettings`, `DockEdge`.
- Produces:

```ts
// src/ink/ToolMenu.tsx
export const TOOL_MENU_LONG_PRESS_MS = 350
export function ToolMenu(props: { tools: readonly Tool[] }): JSX.Element
// Root div.mg-toolmenu[data-edge], position: absolute against the host pane (the host is position: relative).
// Collapsed: button.mg-toolmenu-main (44 × 44) aria-label "Tool menu", data-tool, style --tool-color.
// Expanded: div.mg-toolmenu-panel role="dialog" aria-label="Tools" — a column on left/right edges, a row on top/bottom:
//   one button per tool in `tools` (aria-labels Lasso, Pen, Highlighter, Eraser, Text, Image; aria-pressed), then the active tool's panel:
//   pen: radios Ball · Fountain · Brush (role="radio"), colour slots, "Add colour" (+, while < 12), thickness slots
//   highlighter: colour slots, "Add colour", thickness slots, switch "Draw straight line"
//   eraser: radios Stroke · Segment, buttons "2 mm" · "4 mm" · "8 mm", checkboxes Pen · Highlighter, switch "Auto-deselect"
// Colour slots: button.mg-slot-color aria-label "Colour N"; thickness slots: button.mg-slot-width aria-label "Thickness N" (a dot sized by the mm value).
// Editors (popover inside the panel): role="dialog" aria-label "Edit colour" (12 PRESET_COLORS buttons labelled by hex, canvas.mg-wheel, input aria-label "HEX")
//   or "Edit thickness" (input type=range with the tool's WIDTH_RANGE_MM, label "<mm> mm").

// src/ink/color.ts
export const PRESET_COLORS: readonly string[]   // 12: '#1c1c1a', '#5f6368', '#ffffff', '#d33a2c', '#e8710a', '#f2c94c', '#1f9d55', '#2f9e9e', '#2f6fed', '#7b4fd6', '#c2185b', '#8d5524'
export function hslToHex(h: number, s: number, l: number): string   // degrees, percent, percent → '#rrggbb'
export function normalizeHex(input: string): string | null          // '#abc' | 'abc' | '#aabbcc' → '#aabbcc' lower case; else null
export function wheelColorAt(dx: number, dy: number, radius: number): string
//   hue = atan2(dy, dx) in degrees mod 360; lightness from 100 % at the centre to 25 % at the rim; saturation 90 %
```

Tap rule on the collapsed button: pen or highlighter → eraser; eraser → `previousTool` when that is pen or highlighter, else pen; lasso, text or image → pen. Long-press (`TOOL_MENU_LONG_PRESS_MS`) expands it; a tap elsewhere collapses it. Tapping a slot that is not selected selects it; tapping the selected slot opens its editor. Long-press on a slot followed by a drag across slots reorders them on release. Dragging the collapsed button more than 8 px moves the pill; on release it docks to the nearest edge of the host, `at` = centre along that edge / edge length, saved with `saveSettings({ toolDock })`. Every pointer, touch and click event on the pill calls `stopPropagation`; `contextmenu` is prevented; a new pointerdown resets a gesture whose up or cancel never came.

- [ ] **Step 1: Write the failing tests**

Mount `<div style="position:relative"><ToolMenu tools={['lasso', 'pen', 'highlighter', 'eraser']} /></div>`, stub the host's rect to `new DOMRect(0, 0, 400, 1000)`, and dispatch `PointerEvent`s as `Puck.test.tsx` does.

```tsx
// src/ink/ToolMenu.test.tsx — keeps Puck.test.tsx's intent
it('a tap flips pen and eraser, and lasso goes to pen', ...)
it('a tap from the highlighter goes to the eraser and back to the highlighter', ...)
it('a finger tap flips too', ...)
it('a 350 ms press expands the menu without flipping; a tap elsewhere collapses it', ...)
it('the expanded menu shows the active tool\'s three colour slots and three thickness slots', ...)
  // pen: Colour 1–3 with Colour 1 pressed and --swatch '#1c1c1a'; Thickness 1–3 with Thickness 2 pressed
it('tapping the selected colour slot opens the colour editor; a preset, the wheel and a HEX value set the slot', ...)
  // preset '#2f9e9e' → palettes.pen.colors[0]; HEX 'ABC' + Enter → '#aabbcc'; wheel pointerdown at its rim on the right → hslToHex(0, 90, 25)
it('"Add colour" adds a slot up to 12', ...)
it('tapping the selected thickness slot opens a 0.1–2.0 mm slider in 0.05 mm steps for the pen', ...)
  // min '0.1', max '2', step '0.05'; input value 0.7 → palettes.pen.widthsMm[1] 0.7
it('long-press-drag moves a colour slot', ...)
it('the eraser shows its styles, sizes 2 / 4 / 8 mm, filters and Auto-deselect', ...)
  // click Segment → eraserSettings.style 'segment'; "8 mm" → sizeMm 8; uncheck Highlighter → eraseHighlighter false
it('dragging docks to the nearest edge and remembers it', ...)
  // down (380, 600), move and up at (20, 300) → settings.toolDock { edge: 'left', at: 0.3 }; style left 8px, top 278px
it('stays inside the host', ...)                     // drag to y = -500 → at 0, top 8px
it('pointer and click events never reach the page under the pill', ...)   // a host pointerdown/click listener is never called
it('a new press resets a gesture whose pointerup never came', ...)
it('shows the active tool and colour; Black rings pale at night', ...)

// src/ink/color.test.ts
test('hslToHex', () => { expect(hslToHex(0, 100, 50)).toBe('#ff0000'); expect(hslToHex(120, 100, 25)).toBe('#008000') })
test('normalizeHex accepts three or six digits with or without #', ...)   // '#ABC' → '#aabbcc'; 'a1b2c3' → '#a1b2c3'; 'zzz' → null; '#12345' → null
test('wheelColorAt: white at the centre, darker toward the rim, hue by angle', ...)
  // (0, 0, 50) → '#ffffff'; (50, 0, 50) → hslToHex(0, 90, 25); (0, -50, 50) → hslToHex(270, 90, 25)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ink/ToolMenu.test.tsx src/ink/color.test.ts`
Expected: FAIL. `./ToolMenu` and `./color` do not exist.

- [ ] **Step 3: Implement `color.ts`, the icons and `ToolMenu`**

The wheel is drawn once per open on a 160 px canvas with `hslToHex` per pixel ring and angle step; picking reads `wheelColorAt` from the pointer offset to the canvas centre.

- [ ] **Step 4: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/ink/ToolMenu.tsx src/ink/ToolMenu.test.tsx src/ink/toolmenu.css src/ink/color.ts src/ink/color.test.ts src/app/icons.tsx
git commit -m "ink: tool menu pill with colour and thickness slots, slot editors, edge docking" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Closes backlog: "A puck gesture whose up/cancel never arrives leaves the puck unresponsive (no stale reset); the palette only fits hosts taller than about 272 px; no `contextmenu` guard" (the pill replaces the puck in Task 7).

---

### Task 4: Highlighter, eraser styles, redo gesture

**Files:**
- Create: `src/ink/erase.ts`
- Modify: `src/ink/InkLayer.tsx` (new tool model, highlighter, segment eraser, filters, auto-deselect, eraser cursor, pen hover dot, three-finger redo, new props, `StrokeSvg`)
- Modify: `src/ink/geometry.ts` (`highlighterPath`), `src/ink/ink.css`
- Modify: `src/annot/store.ts` (multi-item undo entries, `replaceStroke`)
- Test: `src/ink/erase.test.ts`, `src/ink/InkLayer.test.tsx`, `src/ink/geometry.test.ts`, `src/annot/store.test.ts`

**Interfaces:**
- Consumes (Task 1): `inkOutlinePath(points, width, cssW, cssH, pen)`, `smoothStrokePoints`, `createLiveOutline`. (Task 2): `tool`, `previousTool`, `setTool`, `isInkTool`, `palettes`, `activeColor`, `activeWidthMm`, `penSettings`, `highlighterSettings`, `eraserSettings`, `mmToFraction`, `A4_WIDTH_MM`, `inkDisplayColor(color, dark)`, `nightInk`, `fingerDraws`, `penActivity`, `PenStyle`.
- Produces:

```ts
// src/ink/InkLayer.tsx
export interface InkLayerProps {
  page: number
  cssW: number
  cssH: number
  strokes: InkStroke[]
  onAddStroke(stroke: InkStroke): void
  onEraseStroke(id: string): void
  onReplaceStroke?(id: string, pieces: InkStroke[]): void   // absent: the segment eraser removes whole strokes
  pageWidthMm?: number    // default A4_WIDTH_MM
  paperDark?: boolean     // default nightInk.value; Black shows pale and the highlighter goes below the ink
  showStrokes?: boolean   // default true; false leaves committed strokes to StrokeSvg runs
}
/** Committed strokes: svg.ink-pen and svg.ink-hl (highlighter above with multiply on light paper, below without it on dark paper). */
export function StrokeSvg(props: { strokes: InkStroke[]; cssW: number; cssH: number; paperDark: boolean }): JSX.Element

// src/ink/geometry.ts
export function highlighterPath(points: number[], cssW: number, cssH: number): string   // smoothed centreline as M…L…, CSS px

// src/ink/erase.ts — isotropic units (y multiplied by height / width)
export function splitStrokeAt(points: number[], cx: number, cy: number, radius: number): number[][] | null
//   null: the circle misses; []: nothing survives; else the surviving pieces in order, each ≥ 2 samples, cut at the circle's edge

// src/annot/store.ts
// AnnotationStore gains: replaceStroke(id: string, pieces: InkStroke[]): void   // tombstones the original and adds the pieces, one undo step
```

Input and stroke rules:
- `draws(e)`: lasso, text and image tools → false. Otherwise pen → true, mouse → `e.button === 0`, touch → `fingerDraws`. `data-tool` mirrors `tool`; `data-mouse-draws` is set when `isInkTool(tool)` and `matchMedia('(pointer: fine)')` matches, and keeps v2's pointer-events and crosshair rules.
- Pen stroke: `{ tool: 'pen', pen: penSettings.style, color: activeColor('pen'), width: mmToFraction(activeWidthMm('pen'), pageWidthMm) }`. Committed pen strokes render with `inkOutlinePath(…, stroke.pen ?? 'fountain')`; a stroke without `tool` is a pen stroke.
- Highlighter stroke: `{ tool: 'highlighter', color: activeColor('highlighter'), width: mmToFraction(activeWidthMm('highlighter'), pageWidthMm) }`, pressure 0.5 on every sample, and only the first and last samples when `highlighterSettings.straight`. It is drawn live and committed by `highlighterPath`, stroked (`stroke-width` = width × cssW, `stroke-linecap="square"`, `stroke-linejoin="round"`, `stroke-opacity` 0.4, `fill="none"`). On the live canvas the same path is stroked at `globalAlpha` 0.4 with the same caps.
- Eraser: radius = `mmToFraction(sizeMm / 2, pageWidthMm)` + the stroke's width / 2. A stroke is skipped unless the filter allows its kind (`tool === 'highlighter'` needs `eraseHighlighter`, any other needs `erasePen`). Stroke style calls `onEraseStroke`. Segment style calls `splitStrokeAt` on the stroke's isotropic points and then `onReplaceStroke(id, pieces)`. The pieces get new ids, the original's `page/color/width/tool/pen`, and points converted back. The drag keeps a local map of replaced ids, so later samples hit the pieces and never the original. Isotropic copies are cached per stroke for the contact. `div.ink-eraser-cursor` (diameter `sizeMm × cssW / pageWidthMm`) follows the pointer while the eraser is down. With `autoDeselect`, the eraser's pointerup calls `setTool(previousTool.value)`.
- A pen `pointermove` with `buttons === 0` over the page shows `div.ink-hover-dot` (the active colour, diameter = width × cssW) under pen and highlighter; `pointerleave` hides it.
- Touch taps: v2's two-finger double tap dispatches `marginalia:undo`; the same rule with three fingers dispatches `marginalia:redo`.

- [ ] **Step 1: Write the failing split and store tests**

```ts
// src/ink/erase.test.ts — a straight stroke along y = 0 from x = 0 to 10, one sample per unit, pressure i / 10
test('returns null when the circle misses', () => expect(splitStrokeAt(line, 5, 3, 1)).toBeNull())
test('a circle in the middle leaves two pieces cut at its edge', () => {
  const pieces = splitStrokeAt(line, 5, 0, 1.5)!
  expect(pieces).toHaveLength(2)
  expect(pieces[0].slice(-3)).toEqual([3.5, 0, expect.closeTo(0.35)])
  expect(pieces[1].slice(0, 3)).toEqual([6.5, 0, expect.closeTo(0.65)])
})
test('a circle over one end leaves one piece', ...)                       // (0, 0, 1.5) → one piece starting at x 1.5
test('a circle over the whole stroke leaves nothing', ...)                // (5, 0, 20) → []
test('a long segment crossing the circle with both ends outside is cut twice', ...)
  // [0,0,.5, 10,0,.5], circle (5, 0, 1) → [[0,0,.5, 4,0,.5], [6,0,.5, 10,0,.5]]
test('a one-sample stroke inside the circle leaves nothing and outside it is missed', () => {
  expect(splitStrokeAt([5, 0, 0.5], 5, 0, 1)).toEqual([])
  expect(splitStrokeAt([5, 3, 0.5], 5, 0, 1)).toBeNull()
})

// src/annot/store.test.ts
it('replaceStroke tombstones the original and adds the pieces in one undo step', ...)
  // undo → original live, pieces deleted; redo → back
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ink/erase.test.ts src/annot/store.test.ts`
Expected: FAIL. `./erase` is missing and `replaceStroke` is not a function.

- [ ] **Step 3: Implement `splitStrokeAt` and `replaceStroke`**

```
splitStrokeAt(points, cx, cy, r):
  pieces = [], cur = [], hit = false
  for i in 0..n-1:
    if i > 0:
      for t in circle crossings of segment (i-1 → i), t in (0, 1), ascending (solve |a + t(b - a) - c| = r):
        q = lerp of x, y, pressure at t
        if p(i-1) was outside before this crossing: cur.push(q); pieces.push(cur); cur = []; hit = true   // entering
        else: cur = [q]                                                                                   // leaving
    if p(i) is inside (distance ≤ r): hit = true; if cur.length: pieces.push(cur); cur = []
    else cur.push(p(i))
  pieces.push(cur)
  return hit ? pieces.filter(p => p.length >= 6) : null
```

"Outside before this crossing" alternates from the inside state of `p(i-1)`. The store's history entries become lists of `{ collection, id, before, after }`, inverted as a group (the notes store pattern).

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/ink/erase.test.ts src/annot/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing InkLayer tests**

Replace every v2 tool-signal write in `InkLayer.test.tsx` with `setTool`/`palettes`. The `beforeEach` resets `tool` to `'pen'`, `palettes` to `DEFAULT_PALETTES`, and the pen, highlighter and eraser settings to their defaults. The `mouseDraws` tests become:

```tsx
it('the mouse draws under pen, highlighter and eraser, and never under lasso', ...)
it('a pen stroke stores its pen style and its width in page millimetres', ...)
  // pageWidthMm 210, Brush, Thickness 3 → { tool: 'pen', pen: 'brush', width: 0.5 / 210, color: '#1c1c1a' }
it('a highlighter stroke is flat, square-capped, 40 % and stores tool highlighter', ...)
  // width 5 / 210; committed svg.ink-hl path has stroke-linecap 'square', stroke-opacity '0.4', fill 'none'; every stored pressure 0.5
it('Draw straight line stores only the first and last samples', ...)
it('on light paper the highlighter sits above the ink with multiply; on dark paper below it', ...)
  // paperDark false: svg.ink-hl after svg.ink-pen with class mg-multiply; paperDark true: svg.ink-hl before svg.ink-pen, no mg-multiply
it('Black shows pale only on dark paper', ...)
it('the segment eraser replaces a stroke by its pieces with new ids', ...)
  // eraserSettings.style 'segment'; erase across the middle of a horizontal stroke → onReplaceStroke(id, [two pieces]) with fresh ids and the original colour, width, tool and pen
it('dragging the segment eraser along a stroke keeps splitting the pieces it made', ...)
  // strokes prop never updated during the drag; eraser moves left to right along the stroke in 5 contacts' worth of samples
  // → every onReplaceStroke after the first targets a piece id from an earlier call, never the original; no piece has fewer than 2 samples
it('without onReplaceStroke the segment eraser removes whole strokes', ...)
it('the eraser filter skips pen or highlighter strokes', ...)
it('Auto-deselect returns to the previous tool on lift', ...)
it('an eraser circle of the eraser size follows the pointer while erasing', ...)   // sizeMm 8, cssW 200, pageWidthMm 210 → width 7.62px (toBeCloseTo)
it('a hovering pen shows a dot of the current colour and size', ...)
it('dispatches marginalia:redo on a three-finger double tap', ...)
it('showStrokes false renders no committed strokes; StrokeSvg renders them', ...)
```

`geometry.test.ts`: `highlighterPath draws the smoothed centreline in CSS px` (a 3-sample normalised line on 200 × 400 starts with `M` at the first sample's CSS position and has no `Q`).

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/ink`
Expected: FAIL. No `onReplaceStroke` calls, no `svg.ink-hl`, and no redo event.

- [ ] **Step 7: Implement the InkLayer changes and CSS**

As in **Input and stroke rules**. The live frame picks the outline by tool: pen goes through `createLiveOutline` with `inkOutlinePath`'s pen, highlighter through `highlighterPath`. `ink.css` gets `.mg-multiply { mix-blend-mode: multiply }`, `.ink-eraser-cursor` and `.ink-hover-dot` (absolute, round, `pointer-events: none`), and drops the base `touch-action` rule that the backlog calls dead.

- [ ] **Step 8: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/ink src/annot/store.ts src/annot/store.test.ts
git commit -m "ink: highlighter below or multiplied over the ink, segment eraser with filters and auto-deselect, three-finger redo" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Closes backlog: "Eraser allocations, … the dead `touch-action` base rule" (the other items on that line stay).

---

### Task 5: Notebook model and sync

**Files:**
- Create: `src/notes/model.ts`, `src/notes/notebookStore.ts`
- Modify: `src/drive/merge.ts` (`mergeNotebooks`; delete `mergeNotes`)
- Modify: `src/drive/library.ts` (the notes companion becomes schema 2)
- Modify: `src/export/markdown.ts` (`notebookToMarkdown`)
- Test: `src/notes/model.test.ts`, `src/notes/notebookStore.test.ts`, `src/drive/merge.test.ts`, `src/drive/library.test.ts`, `src/export/markdown.test.ts`

**Interfaces:**
- Consumes: v2 `NotesDoc`, `isNotesDoc`, `NoteBlock`, `NoteStroke`, `NotesBackground` (types.ts, unchanged); `orderBetween`, `compareOrder`; `newId`, `now`.
- Produces:

```ts
// src/notes/model.ts
type PenStyle = 'ball' | 'fountain' | 'brush'   // same union as types.ts (Task 2); Task 7 swaps it for the import
interface Item { id: string; createdAt: number; updatedAt: number; deleted?: boolean }
export type PageTemplate = 'blank' | 'ruled-narrow' | 'ruled-college' | 'ruled-wide' | 'grid' | 'dots'
export type PaperColor = 'white' | 'yellow' | 'dark'
export interface PageSize { w: number; h: number }   // mm
export const PAGE_SIZES: { a4: PageSize; letter: PageSize; standard: PageSize }   // 210 × 297, 215.9 × 279.4, 160.5 × 207.5 (portrait)
export const TEMPLATE_SPACING_MM: Record<Exclude<PageTemplate, 'blank'>, number>   // 6.4, 7.1, 8.7, 5, 5
export interface NotePage extends Item { order: string; size: PageSize; template: PageTemplate; color: PaperColor }
export interface ObjectBox { x: number; y: number; w: number }   // page-width units
export interface NotebookStroke extends Item { page: string; tool: 'pen' | 'highlighter'; pen: PenStyle; color: string; width: number; points: number[]; z: string }
export interface TextObject extends Item { page: string; box: ObjectBox; text: string; size: 's' | 'm' | 'l'; color: string; z: string }
export interface ImageObject extends Item { page: string; box: ObjectBox; src: string; aspect: number; pdfPage?: number; z: string }
export interface NotesDocV2 { schema: 2; kind: 'notes'; pdfId: string; pdfName: string; pages: NotePage[]; strokes: NotebookStroke[]; texts: TextObject[]; images: ImageObject[] }
export type PageStyle = Pick<NotePage, 'template' | 'color' | 'size'>
export const FIRST_PAGE_ID = 'page-1'
export function emptyNotebook(pdfId: string, pdfName: string, now: number): NotesDocV2   // one page FIRST_PAGE_ID: A4 portrait, blank, white
export function isNotebookDoc(x: unknown): x is NotesDocV2   // object, kind 'notes', schema 2, four arrays
export function convertV1(doc: NotesDoc): NotesDocV2
export interface PageContent { strokes: NotebookStroke[]; texts: TextObject[]; images: ImageObject[] }   // live items, each sorted by z
export type PageLayer = { kind: 'ink'; strokes: NotebookStroke[] } | { kind: 'text'; item: TextObject } | { kind: 'image'; item: ImageObject }
export function pageLayers(content: PageContent): PageLayer[]   // all items by z; consecutive strokes form one ink layer

// src/notes/notebookStore.ts
export type NewStroke = Omit<NotebookStroke, 'z'>
export interface NotebookStore {
  doc: ReadonlySignal<NotesDocV2>
  pages: ReadonlySignal<NotePage[]>                    // live, by compareOrder
  content: ReadonlySignal<Map<string, PageContent>>    // keyed by live page id
  canUndo: ReadonlySignal<boolean>
  canRedo: ReadonlySignal<boolean>
  addPage(after?: string | null, style?: Partial<PageStyle>): NotePage   // undefined: last; null: first; style defaults to a copy of the page it follows (the first page when null)
  deletePage(id: string): void
  duplicatePage(id: string): NotePage                  // style and live items copied with new ids, right after it
  movePage(id: string, after: string | null): void
  setPageStyle(id: string, patch: Partial<PageStyle>, applyToAll: boolean): void   // one undo step
  addStroke(s: NewStroke): NotebookStroke
  removeStroke(id: string): void
  replaceStroke(id: string, pieces: NewStroke[]): void
  addText(t: { page: string; box: ObjectBox; text: string; size: TextObject['size']; color: string }): TextObject
  updateText(id: string, patch: Partial<Pick<TextObject, 'text' | 'box' | 'size' | 'color'>>): void   // consecutive text-only patches of one box are one undo step
  addImage(img: { page: string; src: string; aspect: number; pdfPage?: number; box?: ObjectBox }): ImageObject   // box defaults to w 0.5 centred on the page
  updateImage(id: string, patch: { box: ObjectBox }): void
  removeObject(kind: 'texts' | 'images', id: string): void
  undo(): void
  redo(): void
  replaceFromRemote(doc: NotesDocV2): void             // clears history
}
export function createNotebookStore(initial: NotesDocV2, persist: (doc: NotesDocV2) => void): NotebookStore

// src/drive/merge.ts
export function mergeNotebooks(a: NotesDocV2, b: NotesDocV2): NotesDocV2   // pages, strokes, texts, images per id (winner/mergeItems); pdfId/pdfName from the more recently touched doc

// src/drive/library.ts
export function loadNotebook(pdfId: string): Promise<NotesDocV2>
export function saveNotebook(pdfId: string, doc: NotesDocV2): void
export function refreshNotebook(pdfId: string): Promise<NotesDocV2 | null>
// Retired until Task 7 removes their last caller: loadNotes rejects with Error('Notes moved to the notebook'), refreshNotes resolves null, saveNotes does nothing.

// src/export/markdown.ts
export function notebookToMarkdown(doc: NotesDocV2): string
```

Store rules: every mutation stamps `updatedAt` and calls `persist` synchronously. A new item's `z` is `orderBetween(highest live z on its page, null)`. When `addStroke`, `addText` or `addImage` lands on the last live page and that page had no live items, a page with the same style is added after it in the same undo step. Items on a deleted page are hidden from `content` and come back when the page's deletion is undone.

**v1 conversion (decided).** A4 pages; aspect `A = 297 / 210`. Constants in page-width units: `CONVERT_MARGIN = 0.08` (left and top), `CONVERT_WIDTH = 0.84`, `CONVERT_LINE = 0.032` (one `m` line; an `l` line is `× 18 / 13`), `CONVERT_GAP = 0.016`, `CONVERT_CHARS_PER_LINE = 70`.
- A stroke goes to page `floor(cy / A)`, where `cy` is the middle of its y-range in sheet units. Its y values are offset by that page's top (`index × A`) and may run past the page bottom. It keeps id, times, colour and width, with `tool: 'pen'` and `pen: 'fountain'`.
- Live blocks are taken in `compareOrder`; empty text blocks are skipped. They stack from (`CONVERT_MARGIN`, `CONVERT_MARGIN`) on page 0. A text block is `size: 'l'` when it is the first non-empty text block, else `'m'`; its box w is `CONVERT_WIDTH`; its height is the line height × Σ over its `\n` lines of `max(1, ceil(length / 70))`; its colour is `'#1c1c1a'`. An image's box w is `min(block.w, CONVERT_WIDTH)`, its height `w × aspect`, and `pdfPage` is the block's `page`. Each block is followed by `CONVERT_GAP`. A block that would pass `A − CONVERT_MARGIN` while not at the top moves to the next page's top. Blocks keep id and times.
- Pages: `max(1, highest stroke page + 1, highest block page + 1)`, ids `page-1`, `page-2`, …, order keys chained from `orderBetween(null, null)`, `createdAt` and `updatedAt` 0. All have A4 portrait size, colour `'white'`, and template from the background (`lines` → `ruled-college`, `grid` → `grid`, `dots` → `dots`, `blank` → `blank`).
- z per page, chained from `orderBetween(null, null)`: objects in block order, then strokes by `createdAt` and id. The same input always gives the same output.

**Library (decided).** `Companion<T>` gains `upgrade(doc: unknown): T`, applied to every accepted document read from IndexedDB or downloaded (annotations: identity). The notes companion becomes `NOTEBOOK: Companion<NotesDocV2>`: `accepts` is `isNotesDoc(x) || isNotebookDoc(x)`, `upgrade` is `isNotebookDoc(x) ? x : convertV1(x)`, `newer` is `schema > 2`, `merge` is `mergeNotebooks`, `empty` is `emptyNotebook(pdfId, pdfName, 0)`. Store, tag, `notesFor` key, queue prefix and labels are as before. It replaces `NOTES` in `COMPANIONS` and `fromQueueKey`, and `NOTES` is deleted. `load` persists (dirty and queued) a stored record that `upgrade` converted, and `mergeRemote` leaves the record dirty and queued when the remote was schema 1. A schema-1 file is therefore replaced by schema 2 on the next flush.

- [ ] **Step 1: Write the failing model, merge and markdown tests**

```ts
// src/notes/model.test.ts — v1 fixture: background 'lines'; blocks t1 'Title' (order a), t2 'Body line' (b), i1 image w 0.8 aspect 0.5 page 3 (c), t3 '' (d);
//   strokes s1 y in [0.2, 0.3], s2 y in [1.55, 1.65], s3 y in [1.3, 1.5]
test('convertV1 maps strokes into A4 pages by the middle of their y-range', ...)
  // pages ['page-1', 'page-2'], template 'ruled-college', size { w: 210, h: 297 }, color 'white';
  // s1 and s3 on page-1 with points unchanged; s2 on page-2 with every y reduced by 297 / 210; all tool 'pen', pen 'fountain'
test('convertV1 stacks text and images from the top of page 1 with the fixed line height', ...)
  // t1 { box: { x: 0.08, y: 0.08, w: 0.84 }, size: 'l', color '#1c1c1a' }
  // t2 { y ≈ 0.08 + 0.032 × 18 / 13 + 0.016, size: 'm' }; i1 { y ≈ t2.y + 0.032 + 0.016, w: 0.8, pdfPage: 3 }; t3 skipped
test('convertV1 moves a block that would pass the bottom margin to the next page', ...)
test('convertV1 is deterministic and keeps the v1 ids and times', ...)       // convertV1(doc) deep-equals convertV1(structuredClone(doc))
test('an empty v1 doc converts to one blank A4 page with id page-1', ...)
test('emptyNotebook has one white blank A4 portrait page', ...)
test('isNotebookDoc accepts schema 2 only', ...)
test('pageLayers groups consecutive strokes into one ink layer between objects by z', ...)
  // z: s1 'a', s2 'b', image 'c', s3 'd', text 'e' → [ink [s1, s2], image, ink [s3], text]

// src/drive/merge.test.ts (replaces the mergeNotes tests)
test('mergeNotebooks merges pages, strokes, texts and images by id with tombstones', ...)
test('two devices converting the same schema-1 notes merge without duplicate pages or items', ...)
  // a = convertV1(v1); b = convertV1(v1) then one text edited later → merged has 2 pages, 3 strokes, 2 texts, 1 image, and b's text

// src/export/markdown.test.ts
it('notebookToMarkdown lists text and images per page in page order, top to bottom', () => {
  // live pages P1, P2 (deleted), P3; P1: image pdfPage 3 at y 0.3, text 'First' at y 0.1; P3: text 'Third'; an empty text on P1
  expect(notebookToMarkdown(doc)).toBe('## Notes\n\n### Page 1\n\nFirst\n\n(image, p.3)\n\n### Page 2\n\nThird\n')
})
it('notebookToMarkdown is empty when there is no text or image', ...)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/notes/model.test.ts src/drive/merge.test.ts src/export/markdown.test.ts`
Expected: FAIL. `./model` is missing; `mergeNotebooks` and `notebookToMarkdown` are not exported.

- [ ] **Step 3: Implement `model.ts`, `mergeNotebooks` and `notebookToMarkdown`**

`### Page N` numbers live pages in order; pages with no text or image are skipped but still counted; within a page items sort by `box.y`, then `box.x`.

- [ ] **Step 4: Write the failing store tests**

```ts
// src/notes/notebookStore.test.ts
test('addPage appends a copy of the last page\'s style; null puts it first; after places it between', ...)
test('deletePage tombstones the page and hides its items; undo restores both', ...)
test('movePage reorders pages by order key', ...)
test('setPageStyle changes one page or every page in one undo step', ...)
test('the first stroke on the last page adds a page after it in the same undo step', ...)
  // one page; addStroke → 2 pages; undo → 1 page, no stroke
test('new items get a z above everything on their page', ...)
test('replaceStroke tombstones the original and adds the pieces in one undo step', ...)
test('addImage defaults to half the page width centred on the page', ...)
  // A4, aspect 0.5 → box { x: 0.25, y: (297 / 210 − 0.25) / 2, w: 0.5 }
test('consecutive updateText calls with text only on one box undo as one step', ...)
test('duplicatePage copies the style and the live items with new ids right after it', ...)
test('content groups live items by live page and sorts each kind by z', ...)
test('replaceFromRemote swaps the doc and clears history', ...)
```

- [ ] **Step 5: Run them to verify they fail**

Run: `npx vitest run src/notes/notebookStore.test.ts`
Expected: FAIL. `./notebookStore` does not exist.

- [ ] **Step 6: Implement `createNotebookStore` and run the store tests**

Use the v2 notes store's history shape (lists of `{ collection, before?, after }`, max 100, inverted on undo), with the **Store rules** above. Run: `npx vitest run src/notes` → PASS.

- [ ] **Step 7: Write the failing library tests**

In `src/drive/library.test.ts`, point the v2 `describe('notes')` cases at `loadNotebook`/`saveNotebook`/`refreshNotebook` with schema-2 fixtures (`remoteNotebook(id, pdfId, parent, doc, tagged = true)` beside `remoteNotes`). Change the two newer-schema cases to `schema: 3`. Add:

```ts
test('a stored schema-1 notes record loads converted and is queued for upload as schema 2', ...)
  // idbSet('notes', 'p1', { sidecar: v1, dirty: false }) → loadNotebook equals convertV1(v1); queue has 'notes:p1'; flushQueue uploads isNotebookDoc content
test('a schema-1 remote is converted, merged and uploaded as schema 2', ...)
test('a schema-2 remote merges into local notes', ...)
test('queued schema-1 notes edits from a v2 client merge into a schema-2 remote after the update', ...)
  // remote n1 = convertV1(base) as schema 2 with a later text edit; local record = base + one new v1 block, dirty, queue 'notes:p1'
  // → flushQueue: drive.json('n1') holds the remote's edit and the local block (converted), each id once
```

- [ ] **Step 8: Run them to verify they fail**

Run: `npx vitest run src/drive`
Expected: FAIL. `loadNotebook` is not exported.

- [ ] **Step 9: Implement the library change**

As in **Library (decided)**.

- [ ] **Step 10: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass. `Reader.tsx` still compiles against the retired stubs.

- [ ] **Step 11: Commit**

```bash
git add src/notes/model.ts src/notes/model.test.ts src/notes/notebookStore.ts src/notes/notebookStore.test.ts src/drive src/export
git commit -m "notes: schema-2 notebook with pages and z-ordered items, v1 conversion, store, merge and sync" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Notebook pages UI

**Files:**
- Create: `src/notes/Notebook.tsx`, `src/notes/notebook.css`, `src/notes/paper.tsx`, `src/notes/viewport.ts`, `src/notes/TemplateSheet.tsx`
- Test: `src/notes/Notebook.test.tsx`, `src/notes/paper.test.tsx`, `src/notes/viewport.test.ts`

**Interfaces:**
- Consumes (Task 5): `NotebookStore`, `NotePage`, `PageContent`, `PageStyle`, `PageTemplate`, `PaperColor`, `PAGE_SIZES`, `TEMPLATE_SPACING_MM`, `NotebookStroke`. Existing: `prepareImage`, `ImageTooLargeError` (`src/notes/images.ts`), `showToast`, `penActivity`. The v2 `InkLayer` with exactly `{ page, cssW, cssH, strokes, onAddStroke, onEraseStroke }`. Each page passes its 1-based index as `page`; strokes have y × w/h on the way in and y × h/w on the way out, and a committed stroke becomes `addStroke({ ...s, page: pageId, tool: s.tool ?? 'pen', pen: s.pen ?? 'fountain', points })` without `kind`. Task 7 adds `pageWidthMm`, `paperDark`, `onReplaceStroke`, `showStrokes={false}` and the `StrokeSvg` layers.
- Produces:

```ts
// src/notes/Notebook.tsx
export interface NotebookHandle { currentPage(): string | null; scrollToItem(id: string): void }
export interface NotebookProps { store: NotebookStore; onJumpToPage(page: number): void; handle?: (h: NotebookHandle) => void }
export function Notebook(props: NotebookProps): JSX.Element
// div.mg-notebook (column): div.mg-nb-bar (Add Page menu: Before, After, Last; Template; Image + hidden file input),
//   then div.mg-nb-scroller[data-ink-viewport] holding div.mg-nb-pages; one div.mg-nb-page[data-page=<id>][data-color] per page
//   with PaperBackground, images (img.mg-nb-image, read-only, with button.mg-nb-chip "p.N" when pdfPage), texts (div.mg-nb-text, read-only), then the InkLayer.

// src/notes/viewport.ts
export const NOTEBOOK_GAP_PX = 16
export const NOTEBOOK_MAX_ZOOM = 4
export const PULL_ADD_PX = 80
export function clampZoom(z: number): number                  // [1, NOTEBOOK_MAX_ZOOM]; 1 = fit-width
export function pageCssWidth(pageWmm: number, widestMm: number, paneW: number, zoom: number): number   // (paneW − 2 × gap) × pageWmm / widestMm × zoom
export function zoomScroll(scroll: { left: number; top: number }, anchor: { x: number; y: number }, from: number, to: number): { left: number; top: number }
//   ((left + x) × to / from − x, (top + y) × to / from − y)

// src/notes/paper.tsx
export function PaperBackground(props: { template: PageTemplate; color: PaperColor; cssW: number; widthMm: number }): JSX.Element
// svg.mg-nb-paper with a <pattern> of spacing TEMPLATE_SPACING_MM × cssW / widthMm (none for blank); rule colour '#c9d3de' on white and yellow, 'rgba(255, 255, 255, 0.15)' on dark

// src/notes/TemplateSheet.tsx
export function TemplateSheet(props: { page: NotePage; onApply(patch: PageStyle, applyToAll: boolean): void; onClose(): void }): JSX.Element
// role="dialog" aria-label "Template": radios per template (Blank, Ruled narrow, Ruled college, Ruled wide, Grid, Dots), colour (White, Yellow, Dark),
//   size (A4, Letter, Standard), orientation (Portrait, Landscape), checkbox "Apply to all pages", button Done
```

Layout and input: the canvas is `#e9e9eb` (`#1c1c1e` under `:root[data-theme='night']`). Pages have `box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12)` and are 16 px apart, centred. Paper is `#ffffff`, `#fbf3d0` or `#1f1f21`. Every page uses `pageCssWidth` against the widest page. A two-finger pinch scales `.mg-nb-pages` with a CSS transform while it moves, then on release sets `zoom = clampZoom(…)` and the scroll from `zoomScroll` around the pinch centre. A pinch is ignored while `penActivity.down`. A one-finger double tap (two taps within 300 ms and 30 px) toggles zoom between 1 and 2 at the tap. Ctrl or ⌘ wheel zooms by `exp(−deltaY × 0.01)` at the cursor; a plain wheel scrolls. A one-finger drag that keeps pulling up for `PULL_ADD_PX` after the scroller reaches its end adds a page (`addPage()`), with the hint "Release to add a page" shown while pulling. `currentPage()` is the page with the most visible height. Paste, drop and the Image button run `prepareImage`, then `addImage({ page: currentPage, src, aspect })`. Add Page: Before → `addPage(previous page id ?? null)`, After → `addPage(current)`, Last → `addPage()`. Template opens `TemplateSheet` for the current page and applies through `setPageStyle`. Text boxes render at `size` pt scaled by `cssW / (widthMm / 0.3528)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/notes/viewport.test.ts
test('clampZoom keeps zoom between fit-width and 400 %', () => { expect(clampZoom(0.5)).toBe(1); expect(clampZoom(5)).toBe(4) })
test('pageCssWidth fits the widest page into the pane less 16 px each side', () => {
  expect(pageCssWidth(210, 210, 872, 1)).toBe(840)
  expect(pageCssWidth(160.5, 210, 872, 2)).toBeCloseTo(1284)
})
test('zoomScroll keeps the point under the pinch centre still', () =>
  expect(zoomScroll({ left: 0, top: 100 }, { x: 200, y: 300 }, 1, 2)).toEqual({ left: 200, top: 500 }))

// src/notes/paper.test.tsx
test('ruled college lines repeat every 7.1 mm of page width', ...)   // cssW 840, widthMm 210 → pattern height 28.4
test('grid and dots repeat every 5 mm; blank draws no pattern', ...)  // 20 px at 840 / 210
test('rules are light blue-grey on white and yellow and 15 % white on dark', ...)
```

`src/notes/Notebook.test.tsx`: mount with a real `createNotebookStore`, stub the scroller rect to `new DOMRect(0, 0, 872, 800)` and each page's rect from its laid-out top, so A4 pages are 840 × 1188 px.

```tsx
test('pages stack on the grey canvas 16 px apart and narrower pages are centred', ...)
test('each page shows its paper colour and template', ...)
test('Add Page offers Before, After and Last', ...)
test('the Template sheet changes the current page, or every page with Apply to all', ...)
test('a pen stroke on page 2 is stored on page 2 in page-width units', ...)
  // pen (40, top2 + 84) → (440, top2 + 504) → stroke page 'page-2' with points [40 / 840, 84 / 840, …, 440 / 840, 504 / 840, …]
test('a stroke dragged past the page edge stays on its page, clamped', ...)
test('pulling past the last page adds a page with its template', ...)
test('pinch zooms around the pinch centre between fit-width and 400 %', ...)
test('a two-finger pinch while the pen is down neither zooms nor ends the stroke', ...)
  // pen down on page 1, two touches spread 100 → 300 px, pen moves and lifts → zoom still 1, scroll unchanged, one stroke stored with every pen sample
test('a finger double-tap toggles fit-width and 200 % at the tap', ...)
test('Ctrl-wheel zooms at the cursor; a plain wheel does not zoom', ...)
test('converted text and images show on their pages; the p.N chip jumps to the paper page', ...)
test('Image adds the picked image centred on the current page at half its width', ...)
test('the scroller is the ink viewport', ...)   // .mg-nb-scroller has data-ink-viewport
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/notes/viewport.test.ts src/notes/paper.test.tsx src/notes/Notebook.test.tsx`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement `viewport.ts`, `paper.tsx`, `TemplateSheet.tsx`, `Notebook.tsx` and `notebook.css`**

As in **Layout and input**. The InkLayer goes last in each page, so in this task all ink sits above images and text; Task 7 brings in the z-ordered layers.

- [ ] **Step 4: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/notes/Notebook.tsx src/notes/Notebook.test.tsx src/notes/notebook.css src/notes/paper.tsx src/notes/paper.test.tsx src/notes/viewport.ts src/notes/viewport.test.ts src/notes/TemplateSheet.tsx
git commit -m "notes: paged notebook on a grey canvas with templates, paper colours, pinch zoom and pull-to-add" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Closes backlog: "Ink is stored in sheet units … handwriting drifts from its words after a pane-width change" (pages hold text in pt and ink in page units, so both scale together).

---

### Task 7: Phase A integration and docs

**Files:**
- Modify: `src/app/Reader.tsx`, `src/app/Toolbar.tsx`, `src/app/reader.css`, `src/pdf/Viewer.tsx` (`data-ink-viewport` on `.mg-scroller`)
- Modify: `src/notes/Notebook.tsx`, `src/notes/notebook.css` (tool row, z-ordered layers, new InkLayer props)
- Create: `src/notes/caret.ts` (`caretOffset`, `placeCaret`, `keepCaretVisible` moved unchanged from `blocks.tsx`)
- Modify: `src/ink/tools.ts`, `src/app/settings.ts`, `src/app/boot.tsx`, `src/ink/geometry.ts`, `src/notes/model.ts` (`PenStyle` from `types.ts`), `src/ink/ink.css`, `src/drive/library.ts`, `src/export/markdown.ts` (the removals listed under **v2 names and who removes them**)
- Delete: `src/ink/PenStrip.tsx`, `src/ink/PenStrip.test.tsx`, `src/ink/Puck.tsx`, `src/ink/Puck.test.tsx`, `src/ink/puck.css`, `src/notes/NotesSheet.tsx`, `src/notes/NotesSheet.test.tsx`, `src/notes/blocks.tsx`, `src/notes/SheetInk.tsx`, `src/notes/notesStore.ts`, `src/notes/notesStore.test.ts`, `src/notes/notes.css`
- Modify: `src/app/Settings.tsx` (the `fingerDraws` toggle is labelled "Draw with finger")
- Modify: `README.md`, `docs/testing.md`, `docs/backlog.md`
- Test: `src/app/Reader.test.tsx`, `src/app/Toolbar.test.tsx`, `src/pdf/Viewer.test.tsx`, `src/notes/Notebook.test.tsx`, `src/app/settings.test.ts`, `src/app/Settings.test.tsx`, `src/export/markdown.test.ts`

**Interfaces:**
- Consumes: Task 1 `INK_VIEWPORT_ATTR`; Task 2 `tool`, `setTool`, `isInkTool`, `pageWidthMm`, `Tool`; Task 3 `ToolMenu`; Task 4 `InkLayerProps` (`pageWidthMm`, `paperDark`, `onReplaceStroke`, `showStrokes`), `StrokeSvg`, `AnnotationStore.replaceStroke`; Task 5 `loadNotebook`, `saveNotebook`, `refreshNotebook`, `createNotebookStore`, `NotebookStore`, `pageLayers`, `notebookToMarkdown`; Task 6 `Notebook`, `NotebookHandle`.
- Produces: `ToolbarProps` without `touchUi` and `finePointer`. `ToolMenu` is mounted in the active pane on every device, with `tools={['lasso', 'pen', 'highlighter', 'eraser']}`. The notebook bar gains buttons Lasso · Pen · Highlighter · Eraser (aria-pressed, `setTool`), placed before Add Page.

**Reader decisions:** `penDrawing = computed(() => isInkTool(tool.value))`. On mount, a device without `touchUi` (`penSeen || isIPadOS() || fingerDraws`) calls `setTool('lasso')`, and unmount does the same (this replaces `mouseDraws.value = false`). Keys outside text fields, without modifiers: `l` Lasso, `p` Pen, `h` Highlighter, `e` Eraser; at the end of the Esc cascade, Esc calls `setTool('lasso')` when the tool is not Lasso. Paper overlay: `<InkLayer … pageWidthMm={pageWidthMm(doc.pageSize(page).w)} paperDark={s.nightMode} onReplaceStroke={store.replaceStroke} />`. Notes: `ensureNotes` → `loadNotebook` → `createNotebookStore(doc, (d) => { notesEdited = true; saveNotebook(pdfId, d) })` → `refreshNotebook` → `replaceFromRemote`. A rejection shows "Could not open notes" with a **Retry** button in place of "Loading notes…". `toNotes(page, box)` renders the crop, runs `prepareImage`, then `addImage({ page: handle.currentPage() ?? first page, src, aspect: height / width, pdfPage: page })`, switches the layout, and calls `handle.scrollToItem(id)`. Export appends `notebookToMarkdown(store?.doc.peek() ?? await loadNotebook(pdfId))`. Notebook pages render `pageLayers(content)`: an ink layer is a `StrokeSvg` (y scaled by w/h), an image is `img.mg-nb-image`, a text is `div.mg-nb-text`, and one `InkLayer` with `showStrokes={false}`, `pageWidthMm={page.size.w}`, `paperDark={page.color === 'dark'}` and `onReplaceStroke` goes on top.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/app/Reader.test.tsx — the drive mock gains loadNotebook, saveNotebook, refreshNotebook; vi.mock('../notes/Notebook') records its props and handle
test('the notes pane shows the notebook; To notes adds the crop to the current page at half width, linked to its page', ...)
  // handle.currentPage() 'page-1' → saved notebook has an image { page: 'page-1', pdfPage: 1, box.w 0.5 }; layout 'both'
test('the tool menu sits over the active pane on every device; the toolbar has no Draw button or pen strip', ...)
test('on the laptop the reader opens in Lasso and a mouse drag selects text', ...)
  // default laptop settings → tool 'lasso'; the viewer mock's penDrawing.value false; a selection from the viewer shows the bar and a colour adds the highlight
test('L, P, H and E pick tools; Esc returns to Lasso', ...)
test('paper ink uses the page width in mm and night mode puts the highlighter below the ink', ...)
  // pageOverlay(1, 600, 776) InkLayer props: pageWidthMm ≈ 612 × 0.3528 (doc.pageSize → { w: 612, h: 792 }), paperDark follows nightMode
test('a failed notebook load offers Retry', ...)
test('Copy as Markdown appends the notebook section', ...)
test('closing after a notebook edit queues the notebook and flushes', ...)

// src/notes/Notebook.test.tsx
test('a stroke drawn after an image renders above it, an earlier one below', ...)   // DOM order: svg (s1), img, svg (s2), then .ink-layer
test('the tool row picks Lasso, Pen, Highlighter and Eraser', ...)

// src/app/Toolbar.test.tsx: drop touchUi/finePointer from the props; `no Draw button on any device`
// src/pdf/Viewer.test.tsx: penTool → tool / setTool; the scroller has data-ink-viewport
// src/app/Settings.test.tsx: the finger switch is labelled "Draw with finger"
```

Delete the Reader tests that assert the Draw latch and the puck, and the `notesToMarkdown` and `bindPenPalette` tests.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/app src/notes src/pdf`
Expected: FAIL. The Reader still mounts `NotesSheet` and `Puck`.

- [ ] **Step 3: Implement the integration and the removals**

As in **Reader decisions** and **v2 names and who removes them**. `reader.css` drops `.mg-penstrip`, `.mg-swatch` and `.mg-drawing`; `ink.css` drops `.mg-penstrip*`.

- [ ] **Step 4: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass; `grep -rnE "penTool|mouseDraws|PenStrip|NotesSheet|createNotesStore|bindPenPalette" src` prints nothing.

- [ ] **Step 5: Write the docs**

`README.md`: replace **Notes sheet** with **Notebook** (pages on a grey canvas, Add Page Before · After · Last, pull past the last page, Template sheet: six templates, White · Yellow · Dark, A4 · Letter · Standard, orientation, apply to all; pinch and double-tap zoom, Ctrl-wheel on the laptop; v2 notes convert into pages on first open, text stacked from the top of page 1). Replace **Tool puck** with **Tool menu** (tap flips Pen ⇄ Eraser, long-press expands, colour and thickness slots, tap a selected slot to edit, drag to any edge; on the laptop the mouse draws under Pen, Highlighter and Eraser, and Lasso or Esc stops it; L · P · H · E). Add **Pens** (Ball, Fountain, Brush; widths in millimetres, 0.25 / 0.35 / 0.5 by default; highlighter 3 / 5 / 8 mm; eraser Stroke or Segment, 2 / 4 / 8 mm, filters, Auto-deselect; two-finger double tap undo, three-finger redo).

`docs/testing.md`: under **What v3 added**, one bullet per test file: `geometry.test.ts` (wiggle under half a turn for every pen, ball width, tapers), `liveOutline.test.ts`, `InkLayer.test.tsx` (pressure fallback, chunked live stroke, visible canvas, highlighter, segment eraser, filters, auto-deselect, three-finger redo), `erase.test.ts`, `tools.test.ts`, `settings.test.ts`, `ToolMenu.test.tsx`, `color.test.ts`, `store.test.ts` (`replaceStroke`), `model.test.ts`, `notebookStore.test.ts`, `merge.test.ts`, `library.test.ts` (schema 1 and 2, conversion upload, v2 client edits), `markdown.test.ts`, `viewport.test.ts`, `paper.test.tsx`, `Notebook.test.tsx`, `Reader.test.tsx`, `Toolbar.test.tsx`, `Viewer.test.tsx`. Under **Manual, on device**, a **v3** section: slow handwriting with the Pencil next to Apple Notes, at Fine, Medium and Thick for each pen; the live stroke keeps up at 120 Hz on a long line (write a full page line without lifting); live and lifted strokes look the same at the chunk seams; the segment eraser splits strokes and Undo restores them; the highlighter leaves black ink black on white and yellow paper and sits under the ink on dark paper and on night-mode PDF pages; pinch zoom around the fingers, double-tap fit/200 %, Ctrl-wheel on the laptop; pull past the last page adds one; a v2 notes file opens as pages on every device without duplicates; the pill docks to each edge and stays after relaunch; three-finger double tap redoes. End the section with a line saying the lasso, text boxes, shapes and thumbnails arrive with Phase B.

`docs/backlog.md`: delete the lines Tasks 1, 2, 3, 4 and 6 name; delete the **Notes sheet** items about code that no longer exists (+ Image insertion point, typing coalescing, the Enter guard, `scaleY`, the 300-stroke sheet re-outline, keyboard accessibility of the sheet); delete **Reader** "Loading notes… sticks after a `loadNotes` rejection".

- [ ] **Step 6: Commit**

```bash
git add -A src README.md docs/testing.md docs/backlog.md
git commit -m "reader: notebook and tool menu on both panes, mouse draws under drawing tools, ink widths in page millimetres" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

# Phase B

Starts from `main` after Phase A is deployed. Tasks 8–11 run in parallel; only Task 8 edits `notebookStore.ts` and `annot/store.ts`; only Task 10 edits `InkLayer.tsx`; `Notebook.tsx`, `ToolMenu.tsx`, `Reader.tsx` and the docs are Task 12's.

### Task 8: Lasso, object menu, z-order, copy and paste

**Files:**
- Create: `src/ink/lasso.ts`, `src/notes/Lasso.tsx`, `src/notes/lasso.css`, `src/notes/clipboard.ts`
- Modify: `src/notes/notebookStore.ts` (selection operations), `src/annot/store.ts` (batch stroke operations)
- Test: `src/ink/lasso.test.ts`, `src/notes/Lasso.test.tsx`, `src/notes/clipboard.test.ts`, `src/notes/notebookStore.test.ts`, `src/annot/store.test.ts`

**Interfaces:**
- Consumes: `NotebookStore`, `NotebookStroke`, `TextObject`, `ImageObject`, `ObjectBox`, `PageContent`; `inkOutlinePath`; `tool`, `lassoSettings`, `fingerDraws`, `penActivity`, `PRESET_COLORS`.
- Produces:

```ts
// src/ink/lasso.ts — page-width units
export const LASSO_STROKE_SHARE = 0.6
export interface ItemRef { kind: 'stroke' | 'text' | 'image'; id: string }
export interface LassoItem extends ItemRef { points?: number[]; box?: { x: number; y: number; w: number; h: number } }
export function pointInLoop(x: number, y: number, loop: number[]): boolean      // even-odd; loop flat [x, y, …], closed implicitly
export function strokeInLoop(points: number[], loop: number[]): boolean         // ≥ LASSO_STROKE_SHARE of samples inside
export function rectLoop(x0: number, y0: number, x1: number, y1: number): number[]
export function selectInLoop(items: LassoItem[], loop: number[]): ItemRef[]     // strokes by share, objects by box centre
export function itemsBounds(items: LassoItem[], refs: ItemRef[]): { x: number; y: number; w: number; h: number } | null

// src/notes/clipboard.ts
type Bare<T> = Omit<T, 'id' | 'page' | 'z' | 'createdAt' | 'updatedAt' | 'deleted'>
export interface Clip { strokes: Bare<NotebookStroke>[]; texts: Bare<TextObject>[]; images: Bare<ImageObject>[]; w: number; h: number }   // positions relative to the clip's top-left
export const clipboard: Signal<Clip | null>
export function copyItems(content: PageContent, refs: ItemRef[]): Clip

// src/notes/notebookStore.ts — NotebookStore gains (each one undo step)
moveItems(refs: ItemRef[], dx: number, dy: number, toPage?: string): void   // toPage re-parents and puts the items on top of that page
scaleItems(refs: ItemRef[], origin: { x: number; y: number }, k: number): void   // stroke points and width; object x, y, w (text size unchanged, text reflows)
recolorItems(refs: ItemRef[], color: string): void   // strokes and texts
bringToFront(refs: ItemRef[]): void                  // above the page's highest z, relative order kept
sendToBack(refs: ItemRef[]): void
removeItems(refs: ItemRef[]): void
duplicateItems(refs: ItemRef[], offset: number): ItemRef[]   // new ids, shifted right and down by offset
insertClip(clip: Clip, page: string, at: { x: number; y: number }): ItemRef[]

// src/annot/store.ts — AnnotationStore gains (each one undo step)
updateStrokes(next: InkStroke[]): void
addStrokes(list: InkStroke[]): void
removeStrokes(ids: string[]): void

// src/notes/Lasso.tsx
export interface ObjectMenuProps { colors: readonly string[]; onCut(): void; onCopy(): void; onDuplicate(): void; onDelete(): void; onRecolor(color: string): void; onFront?(): void; onBack?(): void }
export function ObjectMenu(props: ObjectMenuProps): JSX.Element   // role="menu" aria-label "Selection": Cut, Copy, Duplicate, Delete, Recolor (opens the colours), Front, Back (when given)
export interface LassoLayerProps {
  items: LassoItem[]; cssW: number; aspect: number      // the page's items; aspect = height / width
  rect: boolean; objects: boolean                       // rectangular mode; false on PDF pages
  selection: ItemRef[]
  skip?(target: Element): boolean                       // pointerdowns on these targets are left alone
  onSelect(refs: ItemRef[]): void
  onMove(dx: number, dy: number, client: { x: number; y: number }, done: boolean): void
  onScale(origin: { x: number; y: number }, k: number, done: boolean): void
  menu: ObjectMenuProps
}
export function LassoLayer(props: LassoLayerProps): JSX.Element
```

`LassoLayer` listens in the capture phase on its parent while `tool.value === 'lasso'`. Pen and mouse draw the loop (a dashed `path.mg-lasso-loop`). A finger only taps, unless `fingerDraws`. A pointerdown whose target passes `skip` is left alone. A tap on an object selects it. On release it calls `onSelect(selectInLoop(…))`. With a selection it shows `div.mg-lasso-frame` (dashed, corner handles `.mg-lasso-handle[data-corner]`) and `ObjectMenu` above the frame. A drag inside the frame previews the move with a CSS transform and calls `onMove(…, done)` on every move, with `done` true once on release. A corner drag scales about the opposite corner the same way. While a selection exists, the document keys ⌘/Ctrl-C copy, ⌘/Ctrl-X cut, Delete/Backspace delete and Esc clear (ignored inside text fields); a tap outside also clears.

- [ ] **Step 1: Write the failing tests**

```ts
// src/ink/lasso.test.ts
test('a stroke is selected with 60 % of its samples inside the loop and not with 50 %', ...)
test('objects are selected by their box centre', ...)
test('rectLoop selects like a dragged rectangle', ...)
test('itemsBounds covers strokes and boxes', ...)

// src/notes/notebookStore.test.ts
test('moveItems to another page re-parents the items on top of that page in one step', ...)
test('scaleItems scales stroke points and width and object boxes about the origin', ...)
test('recolorItems changes strokes and texts and leaves images', ...)
test('bringToFront and sendToBack keep the selection\'s relative order', ...)
test('duplicateItems and insertClip add copies with new ids', ...)

// src/annot/store.test.ts
it('updateStrokes, addStrokes and removeStrokes are one undo step each', ...)

// src/notes/clipboard.test.ts
test('copyItems stores positions relative to the selection\'s top-left', ...)

// src/notes/Lasso.test.tsx
test('a pen loop selects strokes and objects and opens the menu above the selection', ...)
test('a tap on an object with the Lasso selects it', ...)
test('dragging inside the selection moves it and reports done once', ...)
test('a corner handle scales about the opposite corner', ...)
test('rectangular mode selects by a dragged box', ...)
test('Esc or a tap outside clears the selection', ...)
test('⌘C copies, ⌘X cuts and Delete removes the selection', ...)
test('with objects false and skip on text spans, only ink is selected and text drags pass through', ...)
test('a finger never draws a loop', ...)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ink/lasso.test.ts src/notes src/annot`
Expected: FAIL. The modules and store methods are missing.

- [ ] **Step 3: Implement `lasso.ts`, `clipboard.ts`, the store operations and `Lasso.tsx`**

Scaling a stroke multiplies each `(x − ox, y − oy)` by k and the width by k.

- [ ] **Step 4: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/ink/lasso.ts src/ink/lasso.test.ts src/notes/Lasso.tsx src/notes/Lasso.test.tsx src/notes/lasso.css src/notes/clipboard.ts src/notes/clipboard.test.ts src/notes/notebookStore.ts src/notes/notebookStore.test.ts src/annot
git commit -m "notes: lasso with object menu, move, scale, recolor, front and back, in-app copy and paste" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Text boxes and images as objects

**Files:**
- Create: `src/notes/TextBox.tsx`, `src/notes/ImageObject.tsx`, `src/notes/objects.css`
- Test: `src/notes/TextBox.test.tsx`, `src/notes/ImageObject.test.tsx`

**Interfaces:**
- Consumes: `TextObject`, `ImageObject`, `ObjectBox` (model.ts); `keepCaretVisible`, `placeCaret` (`src/notes/caret.ts`); `MM_PER_PT`.
- Produces:

```ts
// src/notes/TextBox.tsx
export const TEXT_SIZE_PT = { s: 10, m: 13, l: 18 } as const
export const TEXT_BOX_DEFAULT_W = 0.6
export const TEXT_BOX_MIN_W = 0.1
export function textBoxAt(x: number, y: number): ObjectBox   // w 0.6; x clamped so x + w ≤ 1
export interface TextBoxProps {
  item: TextObject; cssW: number; widthMm: number          // page CSS width and page width in mm
  editing: boolean; selected: boolean
  onEdit(): void                                            // double-tap
  onChange(patch: Partial<Pick<TextObject, 'text' | 'box'>>): void
  onDone(): void                                            // blur, Esc
  scroller: () => HTMLElement | null                        // for keepCaretVisible
}
export function TextBox(props: TextBoxProps): JSX.Element
// div.mg-nb-text[data-id] at box.x × cssW, box.y × cssW, width box.w × cssW, font-size TEXT_SIZE_PT[size] × cssW / (widthMm / MM_PER_PT) px, colour item.color, display sans;
// contenteditable="plaintext-only" while editing; selected and not editing: body drag moves (onChange box), side handles .mg-nb-text-handle[data-side='left'|'right'] change w (≥ TEXT_BOX_MIN_W)

// src/notes/ImageObject.tsx
export interface ImageObjectProps { item: ImageObject; cssW: number; selected: boolean; onSelect(): void; onChange(box: ObjectBox): void; onJumpToPage(page: number): void }
export function ImageObjectView(props: ImageObjectProps): JSX.Element
// img.mg-nb-image; selected: drag moves, corner handles .mg-nb-image-handle[data-corner] scale proportionally (w ≥ 0.1, aspect fixed); button.mg-nb-chip "p.N" when pdfPage
```

- [ ] **Step 1: Write the failing tests**

```tsx
test('textBoxAt drops a 60 % wide box at the tap, kept on the page', ...)   // (0.2, 0.3) → { 0.2, 0.3, 0.6 }; (0.7, 0.3) → x 0.4
test('text renders at its point size on the page', ...)                     // m on A4 at cssW 840 → font-size ≈ 18.35px
test('typing reports the text and keeps the caret above the keyboard', ...)
test('a side handle changes the width and the text reflows', ...)          // drag right handle −84 px on cssW 840 → w 0.5
test('dragging a selected box moves it; double-tap edits it', ...)
test('an image corner scales it proportionally and a drag moves it', ...)
test('the p.N chip jumps to the paper page', ...)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/notes/TextBox.test.tsx src/notes/ImageObject.test.tsx`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `TextBox.tsx`, `ImageObject.tsx` and `objects.css`**

As in **Interfaces**.

- [ ] **Step 4: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/notes/TextBox.tsx src/notes/TextBox.test.tsx src/notes/ImageObject.tsx src/notes/ImageObject.test.tsx src/notes/objects.css
git commit -m "notes: text boxes that reflow and images that scale, as movable page objects" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Draw-and-hold shapes

**Files:**
- Create: `src/ink/shapes.ts`
- Modify: `src/ink/InkLayer.tsx` (hold detection, live adjust, commit)
- Test: `src/ink/shapes.test.ts`, `src/ink/InkLayer.test.tsx`

**Interfaces:**
- Consumes: `penSettings.drawAndHold`; the InkLayer live frame.
- Produces:

```ts
// src/ink/shapes.ts — any isotropic units, flat [x, y, pressure]
export type ShapeKind = 'line' | 'rectangle' | 'ellipse' | 'triangle' | 'arrow'
export interface Shape { kind: ShapeKind; points: number[]; anchor: [number, number] }   // anchor: tail for line and arrow, centre otherwise
export const HOLD_MS = 500
export const HOLD_SLOP_PX = 4
export function fitShape(points: number[]): Shape | null   // null below 8 samples or 10 units of path, or when nothing fits
export function adjustShape(shape: Shape, from: [number, number], to: [number, number]): Shape   // rotates and scales about anchor so from maps to to
```

Fit rules: resample every 2 units. A corner is a sample where the direction turns more than 50° across a ±4-sample window; corners within 8 samples merge. The stroke is closed when its end-to-start gap is under 0.2 × the bbox diagonal. Closed with 3 corners → triangle (the corners, closed, 4 samples). Closed with 4 → rectangle (the corners, closed, 5 samples). Closed with ≤ 2 → ellipse in the bbox (65 samples, closed). Closed with ≥ 5 → null. Open with no corner → line (first and last). Open where the part before the first corner is at least 0.6 of the path → arrow: shaft from the first sample to the first corner, head barbs 0.2 × the shaft long at ±30°, as tail, tip, barb, tip, barb. Any other open stroke → null. Every point gets pressure 0.5.

InkLayer: under pen or highlighter with `drawAndHold`, a timer restarts whenever the pointer moves more than `HOLD_SLOP_PX` from where it rested. When it fires and `fitShape` returns a shape, the live frame shows the shape, and later moves call `adjustShape` from the resting point. Pointerup commits the shape's points as an ordinary stroke of the same tool, pen, colour and width.

- [ ] **Step 1: Write the failing tests**

```ts
// src/ink/shapes.test.ts — strokes from the jittered generator in src/ink/testStrokes.ts
test('a closed loop without corners fits an ellipse', ...)
test('a closed stroke with four corners fits a rectangle of 5 samples', ...)
test('a closed stroke with three corners fits a triangle', ...)
test('an open stroke without corners fits a line from first to last sample', ...)
test('a straight stroke ending in a hook fits an arrow', ...)
test('a scribble fits nothing', ...)
test('adjustShape rotates and scales about the anchor', ...)   // line (0,0)–(10,0), from (10,0) to (0,20) → last point (0, 20)

// src/ink/InkLayer.test.tsx (fake timers)
it('holding still 500 ms at the end of a stroke replaces it with the fitted shape', ...)
it('moving while held rescales and rotates the shape; lifting commits one stroke', ...)
it('moving more than 4 px before 500 ms keeps drawing freehand', ...)
it('draw-and-hold is off when penSettings.drawAndHold is false', ...)
it('the highlighter snaps too', ...)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ink/shapes.test.ts src/ink/InkLayer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `shapes.ts` and the hold handling in `InkLayer`**

As in **Interfaces**.

- [ ] **Step 4: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/ink/shapes.ts src/ink/shapes.test.ts src/ink/InkLayer.tsx src/ink/InkLayer.test.tsx
git commit -m "ink: draw-and-hold snaps a stroke to a line, rectangle, ellipse, triangle or arrow" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Thumbnail strip

**Files:**
- Create: `src/notes/Thumbnails.tsx`, `src/notes/thumbnails.css`
- Test: `src/notes/Thumbnails.test.tsx`

**Interfaces:**
- Consumes: `NotebookStore` (`pages`, `content`, `movePage`, `deletePage`, `duplicatePage`); `inkOutlinePath`.
- Produces:

```ts
export const THUMB_W = 160
export const THUMB_LONG_PRESS_MS = 500
export interface ThumbnailsProps { store: NotebookStore; current: string | null; layout: 'column' | 'sheet'; onJump(pageId: string): void; onClose(): void }
export function Thumbnails(props: ThumbnailsProps): JSX.Element
// nav.mg-thumbs[data-layout] aria-label "Pages"; one button.mg-thumb[data-page] aria-label "Page N" (aria-current on current) per live page,
// holding an svg THUMB_W × THUMB_W × h / w: rect in the paper colour, strokes as paths (inkOutlinePath at THUMB_W), texts and images as rect.mg-thumb-box (no image bytes)
// long-press: menu role="menu" with Delete, Duplicate; long-press then drag: movePage after the page under the pointer on release
```

- [ ] **Step 1: Write the failing tests**

```tsx
test('one thumbnail per live page with its paper colour, ink paths and object boxes', ...)
test('a tap jumps to the page', ...)
test('a long-press opens Delete and Duplicate', ...)
test('long-press-drag reorders pages', ...)
test('the sheet layout is a bottom sheet with a close button', ...)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/notes/Thumbnails.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `Thumbnails.tsx` and `thumbnails.css`**

As in **Interfaces**.

- [ ] **Step 4: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/notes/Thumbnails.tsx src/notes/Thumbnails.test.tsx src/notes/thumbnails.css
git commit -m "notes: thumbnail strip with jump, reorder, delete and duplicate" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Phase B integration and docs

**Files:**
- Modify: `src/notes/Notebook.tsx`, `src/notes/notebook.css`, `src/ink/ToolMenu.tsx`, `src/ink/toolmenu.css`, `src/app/Reader.tsx`, `src/app/reader.css`
- Modify: `README.md`, `docs/testing.md`, `docs/backlog.md`
- Test: `src/notes/Notebook.test.tsx`, `src/ink/ToolMenu.test.tsx`, `src/app/Reader.test.tsx`

**Interfaces:**
- Consumes: Task 8 `LassoLayer`, `ObjectMenu`, `ItemRef`, `LassoItem`, `clipboard`, `copyItems`, the store and annotation-store operations; Task 9 `TextBox`, `ImageObjectView`, `textBoxAt`; Task 10 (internal to InkLayer); Task 11 `Thumbnails`, `THUMB_W`; Task 2 `lassoSettings`, `textSize`, `penSettings`, `activeColor`.
- Produces: no new exports.

**Wiring decisions:**
- Notebook bar: Lasso · Pen · Highlighter · Eraser · **Text** · Image · Add Page · **Thumbnails** · Template.
- Thumbnails show as a 160 px left column from 700 px and as a bottom sheet below that.
- Text tool: a tap on a page calls `addText({ page, box: textBoxAt(x, y), text: '', size: textSize.value, color: activeColor('text') })` and edits the new box; the tool stays Text.
- `TextBox`, `ImageObjectView` and `LassoLayer` replace the read-only renderings, in z-layer order.
- A selection is one page's `ItemRef[]`. `onMove` with `done` maps the client point to the page under it and calls `moveItems(refs, dx, dy, toPage)`, with dy carried across page tops in page-width units.
- ⌘/Ctrl-V (outside text fields) or the menu's paste calls `insertClip` at the last pointer position on a page, else centred on `currentPage()`.
- ToolMenu: `tools` adds `'text'`. Text panel: colour slots, "Add colour", radios S · M · L (`textSize`). Pen panel: switch "Draw and hold". Lasso panel: switch "Rectangular" (`lassoSettings.rect`).
- Reader paper pages: a `LassoLayer` with `objects={false}` and `skip` = target inside `.textLayer span`, items from the page's ink with y × h / w, and the annotation store's `updateStrokes` / `removeStrokes` / `addStrokes` behind the menu (no Front/Back). Key `t` picks Text.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/notes/Notebook.test.tsx
test('the Text tool drops a 60 % box at the tap and edits it', ...)
test('a lasso move across a page boundary re-parents the selection to the page under the pointer', ...)
test('⌘V pastes the clipboard at the pointer, else centred on the current page', ...)
test('Thumbnails opens the strip at 160 px and a thumbnail tap scrolls to its page', ...)
// src/ink/ToolMenu.test.tsx
it('the text panel offers colours and S · M · L; the pen panel Draw and hold; the lasso panel Rectangular', ...)
// src/app/Reader.test.tsx
test('a lasso on a PDF page selects ink only and a drag starting on text still selects text', ...)
test('T picks the Text tool', ...)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/notes src/ink src/app`
Expected: FAIL. The notebook has no Text tool, lasso or thumbnails.

- [ ] **Step 3: Implement the wiring**

As in **Wiring decisions**.

- [ ] **Step 4: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 5: Write the docs**

`README.md` **Notebook**: lasso (loop or rectangle, object menu Cut · Copy · Duplicate · Delete · Recolor · Front · Back, drag to move across pages, corners to scale, ⌘C/⌘V), text boxes (tap with Text, S/M/L, drag, side handles, double-tap to edit), images as objects, draw-and-hold shapes (and the off switch), the thumbnail strip. `docs/testing.md`: automated bullets for `lasso.test.ts`, `Lasso.test.tsx`, `clipboard.test.ts`, `TextBox.test.tsx`, `ImageObject.test.tsx`, `shapes.test.ts`, `Thumbnails.test.tsx` and the new Notebook, ToolMenu and Reader cases; on-device v3 Phase B checks: lasso with the Pencil and the object menu's position near the top of a page; moving a selection across pages; a text box above the keyboard on iPhone and iPad; draw-and-hold for each shape at 500 ms; thumbnail reorder by long-press-drag; Pencil hover dot on an M2 iPad Pro or Pencil Pro (report whether Safari sends hover). `docs/backlog.md`: add anything the device checks turn up.

- [ ] **Step 6: Commit**

```bash
git add -A src README.md docs/testing.md docs/backlog.md
git commit -m "notes: lasso, text boxes, image objects and thumbnails in the notebook; lasso on paper ink" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
