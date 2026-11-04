# Marginalia v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pencil strokes look the same while drawn and after lift, put tools on a floating puck, clear the iOS 26 status-bar blur, give the library a calm hero band, add Snip, and add a per-paper notes sheet that syncs through Drive.

**Architecture:** Six modules built in parallel worktrees (ink parity and palette, puck, home, notes sync, notes sheet, Snip), each behind the interfaces listed in its task, then one integration task that wires them into `Reader.tsx`. The notes file reuses the sidecar's local-first queue and merge machinery in `src/drive/library.ts`, generalised by kind. The sheet's ink reuses `InkLayer` through an adapter that converts sheet units.

**Tech Stack:** TypeScript, Vite 8, Preact 11, `@preact/signals` 2, `pdfjs-dist` 6.5, `perfect-freehand` 1.2; tests are vitest + happy-dom with `preact/test-utils` `act` (no Testing Library).

**Spec:** `docs/superpowers/specs/2026-11-03-marginalia-v2-design.md`, extending `docs/superpowers/specs/2026-11-02-marginalia-design.md` (binding for everything v2 does not change).

## Global Constraints

- No new runtime dependencies. Comments are one line describing what the code does. Secrets (Anthropic key, Drive token) only in IndexedDB; never in URLs, logs, sidecars, notes files, exports or source.
- Tool state belongs to the input: finger and mouse never enter a highlighter mode; the Pencil owns Pen/Eraser/Select; finger never draws unless `fingerDraws`.
- Every local edit is in IndexedDB before any network call; sync merges, never overwrites.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Checks: `export PATH="$HOME/.local/node/bin:$PATH"; npx tsc -b && npx vitest run && npm run build`.
- Shared types live in `src/types.ts`; only Task 4 edits it. Page annotations stay normalised to the unrotated page (`Box`, x/y/w/h in [0, 1]); pages are 1-based. Notes ink is in sheet units: x and y both divided by the sheet width.
- Drive scopes exactly `https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file`. Sidecar `<pdf name without .pdf>.marginalia.json`, `appProperties { marginalia: "1", pdf }`; notes `<pdf name without .pdf>.marginalia-notes.json`, `appProperties { marginalia: "notes", notesFor }` (never a `pdf` key, which v1 reads as the sidecar's), both in the PDF's folder.
- Touch targets ≥ 44 px. Everything works with mouse, touch and pen. No CSS framework, no icon fonts (inline SVG), no web fonts. The notes sheet lives in the lazy reader chunk.
- A task edits only the files its **Files** block names (plus its tests). `Toolbar.tsx` and `Reader.tsx` are edited by Task 7 only, except the line ranges Tasks 1 and 6 name. `README.md` and `docs/testing.md` are edited by Task 7 only (parallel tasks would conflict); Task 7's doc step carries every task's lines.

## Order and ownership

| Task | Branch | After | Runs beside |
|------|--------|-------|-------------|
| 1 Pencil parity + palette | `v2/pencil` | — | 3, 4, 5, 6 |
| 2 Tool puck | `v2/puck` | 1 | 3, 5, 6 |
| 3 Status bar + home | `v2/home` | 4 | 1, 2, 5, 6 |
| 4 Notes model + sync (+ home-art index) | `v2/notes-sync` | — | 1, 6 |
| 5 Notes sheet UI | `v2/notes-sheet` | 4 | 1, 2, 3, 6 |
| 6 Snip | `v2/snip` | — | 1–5 |
| 7 Reader integration + docs | `v2/integrate` | 1–6 merged | — |

Each branch starts from the v2 base branch (`feat/v2-plan`, or the branch it depends on once merged). Shared files: `src/app/settings.ts` (1 → 2 → 7, serial), `src/app/Toolbar.tsx` (1: lines 4, 7, 42–75; 6: lines 88–101; then 7), `src/app/Reader.tsx` (6: lines 29, 283–326; then 7), `src/drive/library.ts` (4 only), `src/types.ts` and `src/config.ts` (4 only).

## Review Focus

1. A notes file that passes 5 MB (three or four snips or photos) — Drive's simple and multipart uploads stop at 5 MB, so the upload must switch to a resumable session instead of failing in the queue forever. (Task 4: `notes over the simple-upload limit go up through a resumable session`)
2. A palm resting on the iPad while Snip is armed, then the Pencil drags — the box must follow the Pencil, not the palm. (Task 6: `a pen landing during a touch-started snip takes the box over`)
3. Switching the layout to Notes and back — the paper returns to the page it was on, and no position from the hidden or remounted viewer is saved. (Task 7: `Notes and back returns the paper to where it was`)
4. A stored Both layout on an iPad window under 700 px (Split View, Slide Over) — show Paper, offer Paper · Notes, and keep the stored choice for when the window widens. (Task 7: `a stored Both on a narrow window shows the paper and keeps the setting`)
5. A remote notes file that is not a notes document (truncated JSON written by a crashed upload, or a sidecar body) — never merged; the local notes stay and are uploaded over it. (Task 4: `a remote notes file that is not a notes document is never merged and gets the local notes`)

---

### Task 1: Pencil — live parity and palette

**Files:**
- Modify: `src/ink/geometry.ts` (add `inkOutlinePath`, move `pressureVaries` here)
- Modify: `src/ink/InkLayer.tsx` (live render; `StrokePath` uses `inkOutlinePath`)
- Modify: `src/ink/tools.ts` (presets)
- Create: `src/ink/PenStrip.tsx`; Modify: `src/ink/ink.css` (strip styles, `.mg-penstrip-*`)
- Modify: `src/app/Toolbar.tsx` line 4 (`import { mouseDraws, penTool } from '../ink/tools'`, add `import { PenStrip } from '../ink/PenStrip'`), delete line 7 (`PEN_COLORS`) and lines 42–75 (`TOOLS`, `PenStrip`). Nothing else in this file.
- Modify: `src/app/settings.ts` (`penColor`, `penWidth`, `bindPenPalette`), `src/app/boot.tsx` (call `bindPenPalette()` after `loadSettings`)
- Test: `src/ink/InkLayer.test.tsx`, `src/ink/geometry.test.ts`, `src/ink/PenStrip.test.tsx`, `src/app/settings.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `src/ink/tools.ts`: `PEN_COLORS: readonly { name: string; value: string }[]` = Red `#d33a2c`, Black `#1c1c1a`, Blue `#2f6fed`, Green `#1f9d55`, Orange `#e8710a`, Purple `#7b4fd6` (this order); `PEN_WIDTHS: readonly { name: 'Fine' | 'Medium' | 'Thick'; value: number }[]` = 0.0025, 0.004, 0.007 (fractions of page or sheet width); `DEFAULT_PEN_COLOR = '#d33a2c'`; `DEFAULT_PEN_WIDTH = 0.004`. `penTool`, `penColor`, `penWidth`, `mouseDraws`, `fingerDraws`, `penActivity` keep their names.
  - `src/ink/geometry.ts`: `inkOutlinePath(points: number[], width: number, cssW: number, cssH: number): string` (normalised points and width → SVG path in CSS px); `pressureVaries(points: number[]): boolean`.
  - `src/ink/PenStrip.tsx`: `PenStrip(props: { withSelect: boolean; layout?: 'row' | 'stack' }): JSX.Element` — `role="group" aria-label="Pen tools"`; buttons with aria-labels `Pen`, `Eraser`, `Select` (when `withSelect`), `Fine`, `Medium`, `Thick`, and the six colour names; `aria-pressed` on the active ones; picking a colour or width while the eraser or select is active switches to `pen`. `stack` puts tools, widths and colours on three rows (the puck popover); `row` is one line (the toolbar).
  - `src/app/settings.ts`: `AppSettings.penColor: string` (default `DEFAULT_PEN_COLOR`), `AppSettings.penWidth: number` (default `DEFAULT_PEN_WIDTH`); `bindPenPalette(): () => void` — copies stored values into `penColor`/`penWidth` (a value not in the presets falls back to the default) and saves the signals back whenever they change; returns the unsubscribe.
  - `InkLayerProps` unchanged.

- [ ] **Step 1: Write the failing live-render tests in `src/ink/InkLayer.test.tsx`**

Extend the `pointer` helper with `predicted?: { x: number; y: number; pressure?: number }[]` passed as `predictedEvents` (happy-dom honours it). Add:

```tsx
describe('InkLayer live render', () => {
  let paths: string[]
  let frames: FrameRequestCallback[]
  const ctx = { setTransform: vi.fn(), clearRect: vi.fn(), fill: vi.fn(), fillStyle: '' }
  const flush = () => frames.splice(0).forEach((cb) => cb(0))

  beforeEach(() => {
    paths = []
    frames = []
    vi.stubGlobal('Path2D', class { constructor(d: string) { paths.push(d) } })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    ctx.fill.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('fills the live stroke once per frame with the outline the committed stroke gets', async () => {
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40, pressure: 0.3 }))
    text.dispatchEvent(pointer('pointermove', { x: 60, y: 120, pressure: 0.5 }))
    text.dispatchEvent(pointer('pointermove', { x: 100, y: 200, pressure: 0.6 }))
    expect(frames).toHaveLength(1)
    flush()
    expect(ctx.fill).toHaveBeenCalledTimes(1)
    const lastLive = paths.at(-1)!
    text.dispatchEvent(pointer('pointerup', { x: 100, y: 200, pressure: 0 }))
    await mount({ strokes: added })
    expect(layer.querySelector('svg path')!.getAttribute('d')).toBe(lastLive)
  })

  it('draws predicted samples live but never stores them', async () => {
    const text = await mount()
    text.dispatchEvent(pointer('pointerdown', { x: 20, y: 40, pressure: 0.3 }))
    text.dispatchEvent(pointer('pointermove', { x: 100, y: 200, pressure: 0.6, predicted: [{ x: 180, y: 360, pressure: 0.6 }] }))
    flush()
    const predictedFrame = paths.at(-1)!
    text.dispatchEvent(pointer('pointerup', { x: 100, y: 200, pressure: 0 }))
    expect(added[0].points).toEqual([0.1, 0.1, 0.3, 0.5, 0.5, 0.6])
    await mount({ strokes: added })
    expect(layer.querySelector('svg path')!.getAttribute('d')).not.toBe(predictedFrame)
  })
})
```

In `src/ink/geometry.test.ts` add `inkOutlinePath scales normalised points to CSS px`: `inkOutlinePath([0.1, 0.1, 0.5, 0.5, 0.5, 0.6], 0.01, 200, 400)` equals `strokeOutlinePath([20, 40, 0.5, 100, 200, 0.6], 2, true)`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ink/InkLayer.test.tsx src/ink/geometry.test.ts`
Expected: FAIL — `inkOutlinePath` is not exported; the live test sees `ctx.fill` never called.

- [ ] **Step 3: Implement `inkOutlinePath` and the live frame loop**

`inkOutlinePath` scales x by `cssW`, y by `cssH`, width by `cssW`, and calls `strokeOutlinePath(px, width * cssW, pressureVaries(points))`; `StrokePath` uses it. In `InkLayer`, `LiveStroke` gains `predicted: number[]` (replaced, never appended, on each move) and the layer keeps one pending frame id. `openCanvas` no longer sets stroke styles. Delete the per-segment `stroke()` in `addSample`; it schedules a frame instead:

```ts
const schedule = () => { if (!frameId) frameId = requestAnimationFrame(frame) }
const frame = () => {
  frameId = 0
  const s = live
  if (!s?.ctx) return
  const { cssW, cssH } = propsRef.current
  const pts = simplifyPoints(s.points, SIMPLIFY_PX / cssW).concat(s.predicted)
  s.ctx.clearRect(0, 0, cssW, cssH)
  s.ctx.fillStyle = s.color
  s.ctx.fill(new Path2D(inkOutlinePath(pts, s.width, cssW, cssH)))
}
```

`onPointerMove` sets `s.predicted` from `e.getPredictedEvents?.()` (normalised and clamped like `addSample`, pressure as in `addSample`), adds the coalesced samples, then `schedule()`. `discard()` cancels a pending frame. The commit is unchanged (`simplifyPoints(s.points, SIMPLIFY_PX / cssW)`), so the last live frame without predictions is the committed outline.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/ink`
Expected: PASS, including every existing InkLayer test.

- [ ] **Step 5: Write the failing palette tests**

`src/ink/PenStrip.test.tsx`:

```tsx
it('offers three widths and six colours and marks the active ones', () => {
  // render <PenStrip withSelect /> ; for each of Fine, Medium, Thick, Red, Black, Blue, Green, Orange, Purple a button exists
  // Medium and Red have aria-pressed="true" with the default signals
})
it('a width or colour pick sets the signal and returns from the eraser to the pen', () => {
  penTool.value = 'eraser'
  // click Thick → penWidth.value === 0.007, penTool.value === 'pen'
  penTool.value = 'select'
  // click Orange → penColor.value === '#e8710a', penTool.value === 'pen'
})
it('leaves Select out without withSelect', () => { /* button[aria-label="Select"] is null */ })
```

`src/app/settings.test.ts` (import `../ink/tools` dynamically after `vi.resetModules()` so the signals are the ones `settings.ts` binds):

```ts
test('pen colour and width persist per device; values outside the presets fall back', async () => {
  const idb = await import('../lib/idb')
  await idb.idbSet('settings', 'app', { penColor: '#2f6fed', penWidth: 0.007 })
  await mod.loadSettings()
  const tools = await import('../ink/tools')
  const stop = mod.bindPenPalette()
  expect(tools.penColor.value).toBe('#2f6fed')
  expect(tools.penWidth.value).toBe(0.007)
  tools.penColor.value = '#e8710a'
  await vi.waitFor(async () => expect((await idb.idbGet<{ penColor: string }>('settings', 'app'))!.penColor).toBe('#e8710a'))
  stop()
  await idb.idbSet('settings', 'app', { penColor: '#ff00ff', penWidth: 3 })
  await mod.loadSettings()
  mod.bindPenPalette()
  expect(tools.penColor.value).toBe('#d33a2c')
  expect(tools.penWidth.value).toBe(0.004)
})
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/ink/PenStrip.test.tsx src/app/settings.test.ts`
Expected: FAIL — `./PenStrip` does not exist; `bindPenPalette` is not a function.

- [ ] **Step 7: Implement the presets, `PenStrip`, `bindPenPalette`, and the Toolbar import**

`PenStrip` is the old Toolbar strip moved to `src/ink/PenStrip.tsx` (it imports `Icon` from `../app/icons` and `./ink.css`) plus the width row (each width button shows a filled dot whose diameter follows the preset). `bindPenPalette` uses `effect` from `@preact/signals` and calls `saveSettings` only when a signal differs from `settings.peek()`. `boot.tsx` calls it right after `loadSettings()` resolves. Toolbar keeps rendering `<PenStrip withSelect />` / `<PenStrip withSelect={false} />` where it did.

- [ ] **Step 8: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/ink src/app/Toolbar.tsx src/app/settings.ts src/app/settings.test.ts src/app/boot.tsx
git commit -m "ink: live stroke uses the committed outline; widths and six colours per device" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Tool puck

**Files:**
- Create: `src/ink/Puck.tsx`, `src/ink/puck.css`
- Modify: `src/app/settings.ts` (`puckY`)
- Test: `src/ink/Puck.test.tsx`

**Interfaces:**
- Consumes (Task 1): `PenStrip({ withSelect, layout: 'stack' })`, `penTool`, `penColor`, `PEN_COLORS`; `settings`, `saveSettings`.
- Produces:
  - `src/ink/Puck.tsx`: `Puck(props: { visible: boolean }): JSX.Element | null`; `PUCK_LONG_PRESS_MS = 350`. Root `button.mg-puck` (44 × 44, round), `position: absolute; right: 8px` against the nearest positioned ancestor (the host pane must be `position: relative`), `data-tool={penTool.value}`, `style="--puck-color: <penColor>"`, `aria-label="Pen tools"`. Popover `div.mg-puck-pop` with `role="dialog" aria-label="Pen palette"` holding `<PenStrip withSelect layout="stack" />`, anchored to the left of the puck.
  - `src/app/settings.ts`: `AppSettings.puckY: number` — the puck centre as a fraction of the host height, default `0.6`, stored clamped to [0, 1].

- [ ] **Step 1: Write the failing tests in `src/ink/Puck.test.tsx`**

Mount `<div style="position:relative"><Puck visible /></div>`; stub the host's `getBoundingClientRect` to `new DOMRect(0, 0, 400, 1000)`; dispatch `PointerEvent`s on the puck (`pointerType` pen or touch) and on `document.body`.

```tsx
it('a tap toggles pen and eraser, and from select goes to pen', ...)          // pen→eraser→pen; select→pen
it('a finger tap toggles too', ...)                                            // pointerType 'touch'
it('a 350 ms press opens the palette without toggling; a tap elsewhere closes it', () => {
  vi.useFakeTimers()
  // pointerdown on puck; advanceTimersByTime(349) → no [aria-label="Pen palette"]
  // advanceTimersByTime(1) → palette present; pointerup → penTool unchanged
  // pointerdown on document.body → palette gone
})
it('choosing in the palette keeps it open', ...)                               // click Blue inside → still open, penColor '#2f6fed'
it('dragging along the edge moves the puck and remembers the position', async () => {
  // down at y=600, move to y=300, up → settings.value.puckY === 0.3, penTool unchanged, style.top === `${300 - 22}px`
})
it('keeps the puck inside the host', ...)                                      // drag to y=-500 → puckY 0, top === '8px'
it('shows the active tool and colour', ...)                                    // data-tool and --puck-color follow the signals
it('renders nothing when not visible', ...)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ink/Puck.test.tsx`
Expected: FAIL — `./Puck` does not exist.

- [ ] **Step 3: Implement `Puck`**

Pointer handling on the puck: `setPointerCapture` on down and `stopPropagation` on every event; movement over 8 px makes it a drag (cancels the long-press timer); release under `PUCK_LONG_PRESS_MS` without a drag is a tap: `pen` → `eraser`, `eraser` → `pen`, `select` → `pen`. Rendered top = clamp(`puckY × hostH − 22`, 8, `hostH − 52`). `saveSettings({ puckY })` once on drag end. Outside-tap close: document `pointerdown` capture listener while open, ignoring targets inside the puck or popover. `touch-action: none` on the puck. The icon is `pen`, `eraser` or `select` from `../app/icons` with a colour ring from `--puck-color`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/ink/Puck.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run all checks and commit**

Run: `npx tsc -b && npx vitest run && npm run build` — all pass.

```bash
git add src/ink/Puck.tsx src/ink/puck.css src/ink/Puck.test.tsx src/app/settings.ts
git commit -m "ink: floating tool puck — tap flips pen and eraser, long-press opens the palette" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Status bar and home

**Files:**
- Modify: `index.html` (delete the `apple-mobile-web-app-status-bar-style` meta; keep `viewport-fit=cover`)
- Modify: `src/app/theme.css` (`--font-display`)
- Create: `src/library/hero.svg` (copy of `docs/superpowers/specs/hero-fallback.svg`, unchanged), `src/library/Hero.tsx`, `src/library/hero.css`, `src/library/quotes.ts`, `src/library/homeArt.ts`
- Modify: `src/library/Library.tsx` (Hero above the header), `src/app/Onboarding.tsx` (Hero at the top of `ConnectStep` and `RootPicker`)
- Test: `src/library/quotes.test.ts`, `src/library/homeArt.test.ts`, `src/library/Hero.test.tsx`, `src/app/index-html.test.ts`, `src/library/Library.test.tsx`

**Interfaces:**
- Consumes (Task 4): `LibraryIndex.homeArt?: HomeArtFiles` and `HomeArtSlot` (set by `syncLibrary`), `library` signal; `downloadFile(id)` from `src/drive/api.ts`; `getAccessToken()`.
- Produces:
  - `src/app/theme.css`: `--font-display: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;` on `:root`. Task 5 uses it with a fallback.
  - `src/library/quotes.ts`: `interface Quote { text: string; author: string; source: string }`; `QUOTES: readonly Quote[]` (8–16 entries, each ≤ 14 words, each one the implementer can tie to a named work; acceptable examples: Bacon, *Of Studies*, "Reading maketh a full man; conference a ready man; and writing an exact man."; Thoreau, *Walden*, "Books must be read as deliberately and reservedly as they were written."; Emerson, *The American Scholar*, "Books are the best of things, well used; abused, among the worst."); `pickQuote(seed: number): Quote` = `QUOTES[mod(floor(seed), QUOTES.length)]`.
  - `src/library/homeArt.ts`: `pickHomeArt(files: HomeArtFiles | undefined, landscape: boolean): DriveNode | undefined` — landscape viewport: `landscape ?? generic ?? portrait`; portrait viewport: `portrait ?? generic ?? landscape`; nothing → `undefined` (the drawing). `isLandscape: Signal<boolean>` driven by a `matchMedia('(orientation: landscape)')` change listener (started by `watchOrientation(): () => void`). `homeArtUrl: Signal<string | null>`; `refreshHomeArt(node: DriveNode | undefined, keep: string[]): Promise<void>` — shows `node` and deletes cached records whose file id is not in `keep` (the ids currently in the index). Cache: one IndexedDB `meta` record per file under key `` `homeArt:${fileId}` ``: `{ id: string; version: string; type: string; bytes: ArrayBuffer }` (bytes, like the PDF cache). Type from the extension: png → `image/png`, jpg/jpeg → `image/jpeg`, webp → `image/webp`.
  - `src/library/Hero.tsx`: `Hero(): JSX.Element` — `div.mg-hero` containing either `img.mg-hero-photo` (`src={homeArtUrl}`) or `img.mg-hero-fallback` (`src` = `import heroUrl from './hero.svg'`), with `alt=""`, and `figure.mg-hero-quote` (`<blockquote>` text + `<figcaption>` "author, source"). The quote is `pickQuote(LAUNCH_SEED)` with `LAUNCH_SEED` drawn once at module load.

- [ ] **Step 1: Write the failing tests**

```ts
// src/library/quotes.test.ts
test('pickQuote is deterministic and wraps any seed into the list', () => {
  expect(pickQuote(5)).toBe(pickQuote(5))
  expect(pickQuote(QUOTES.length)).toBe(pickQuote(0))
  expect(pickQuote(-1)).toBe(QUOTES.at(-1))
  expect(pickQuote(2.7)).toBe(pickQuote(2))
})
test('8 to 16 quotations of at most 14 words, each attributed to an author and a work', () => {
  expect(QUOTES.length).toBeGreaterThanOrEqual(8)
  expect(QUOTES.length).toBeLessThanOrEqual(16)
  for (const q of QUOTES) {
    expect(q.text.trim().split(/\s+/).length).toBeLessThanOrEqual(14)
    expect(q.author.trim()).not.toBe('')
    expect(q.source.trim()).not.toBe('')
  }
})

// src/library/homeArt.test.ts — FakeDrive + signIn from src/drive/test-helpers; URL.createObjectURL stubbed to return `blob:<n>`
test.each([
  // [present files, landscape viewport, expected], L = landscape file, P = portrait file, G = generic file
  [['L', 'P', 'G'], true, 'L'], [['L', 'P', 'G'], false, 'P'],
  [['L', 'P'], true, 'L'],      [['L', 'P'], false, 'P'],
  [['L', 'G'], true, 'L'],      [['L', 'G'], false, 'G'],
  [['P', 'G'], true, 'G'],      [['P', 'G'], false, 'P'],
  [['L'], false, 'L'],          [['P'], true, 'P'],
  [['G'], true, 'G'],           [['G'], false, 'G'],
  [[], true, undefined],        [[], false, undefined],
])('pickHomeArt(%j, landscape=%s) → %s', ...)
test('downloads a picture once and serves the cached bytes while its version is unchanged', ...)
  // refreshHomeArt(L v1, ['L']) twice → one alt=media call; idbGet('meta','homeArt:L') has { id: 'L', version: '1', type: 'image/jpeg' } and bytes instanceof ArrayBuffer
test('downloads again when the Drive version changes', ...)        // drive.update → L v2 → a second media call, record version '2'
test('caches each file separately and drops records of files no longer in the index', ...)
  // refresh(L, ['L','P']) then refresh(P, ['L','P']) → records homeArt:L and homeArt:P; refresh(P, ['P']) → homeArt:L gone
test('no picture shows the drawing and forgets every cached picture', ...)  // refreshHomeArt(undefined, []) → homeArtUrl null, no homeArt:* records
test('offline keeps the cached picture', ...)                       // fetch rejects TypeError → homeArtUrl still set from the record
test('a later call wins over a slower earlier one', ...)             // mocked fetch, not FakeDrive: first media response is a deferred promise; second refresh(undefined, []) resolves; releasing the first leaves homeArtUrl null

// src/library/Hero.test.tsx
test('shows the fallback drawing when there is no picture', ...)    // img.mg-hero-fallback present, no img.mg-hero-photo
test('shows the owner picture when one is cached', ...)             // homeArtUrl.value = 'blob:1' → img.mg-hero-photo src 'blob:1'
test('switches picture when the device rotates', ...)
  // index has landscape and portrait files, both cached; matchMedia stub starts portrait → photo from homeArt:P; fire the stub's change with matches true → photo from homeArt:L
test('shows one quotation with its attribution', ...)               // blockquote text is some QUOTES[i].text; figcaption contains its author
test('the fallback drawing has no text and stays under 40 KB', () => {
  const svg = readFileSync('src/library/hero.svg', 'utf8')
  expect(svg).not.toMatch(/<text|<foreignObject/)
  expect(Buffer.byteLength(svg)).toBeLessThanOrEqual(40 * 1024)
})

// src/app/index-html.test.ts
test('index.html has no status-bar-style meta and keeps viewport-fit=cover', () => {
  const html = readFileSync('index.html', 'utf8')
  expect(html).not.toContain('apple-mobile-web-app-status-bar-style')
  expect(html).toContain('viewport-fit=cover')
})

// src/library/Library.test.tsx (add)
test('the hero band sits above the library header', ...)            // .mg-hero is the first child of .mg-lib and precedes .mg-lib-head
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/library src/app/index-html.test.ts`
Expected: FAIL — modules missing; the meta is still present.

- [ ] **Step 3: Implement**

`refreshHomeArt`: a call counter so only the latest call writes `homeArtUrl`; first delete `homeArt:*` records whose id is not in `keep`; `undefined` node → revoke and clear the URL; record with the same id and version → URL from the cached bytes; otherwise, when `getAccessToken()` is set, `downloadFile(node.id)` → store the record → URL; a failed or impossible download keeps a cached record's URL if one exists, else `null`. Revoke the previous object URL whenever it changes. `Hero` calls `watchOrientation()` on mount and runs `refreshHomeArt(pickHomeArt(files, isLandscape.value), ids of files)` in an effect keyed on the picked node's id and version and the set of file ids, so a rotation or a sync that changes the files switches the picture.

`hero.css`: band height `33dvh` below 700 px and `clamp(240px, 30dvh, 320px)` from 700 px; images `width: 100%; height: 100%; object-fit: cover`; a `mask-image` and `-webkit-mask-image` `linear-gradient(to bottom, #000 60%, transparent)` so the band fades into `var(--bg)`; `.mg-hero-photo { filter: grayscale(1) }`, night `grayscale(1) brightness(0.8)`; `:root[data-theme='night'] .mg-hero-fallback { filter: invert(1) }`; quote in `var(--font-display)`, a horizontal strip along the band's bottom below 700 px, a vertical cartouche (`writing-mode: vertical-rl`, bordered, top-right) from 700 px. The same file sets `font-family: var(--font-display)` on `.mg-onboard h1` and `.mg-crumbs [aria-current]`. With the meta gone `--safe-top` is 0 on iOS; keep every `--safe-top` use as an additive padding (the toolbar's `min-height` already falls back to `--tap + 4px`) and add no rule that assumes it is positive. WebKit has mis-sized `100vh` in home-screen apps without the meta, so `theme.css` gets `html, body { height: 100% }` and the app shell keeps `height: 100dvh` with `min-height: 100%` as the fallback; the device checklist (Task 7) confirms the shell fills the screen with no gap at the bottom.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/library src/app`
Expected: PASS.

- [ ] **Step 5: Run all checks and commit**

Run: `npx tsc -b && npx vitest run && npm run build` — all pass.

```bash
git add index.html src/app/theme.css src/app/Onboarding.tsx src/app/index-html.test.ts src/library
git commit -m "home: hero band with the Drive picture or the fallback drawing, a reading quotation, display serif; drop the iOS status-bar meta" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Companion files — notes model and sync

**Files:**
- Modify: `src/types.ts` (append a `// Notes` block; extend `LibraryIndex`)
- Modify: `src/config.ts` (`NOTES_SUFFIX`, `HOME_ART_FILE`)
- Create: `src/lib/order.ts`
- Modify: `src/lib/idb.ts` (store `notes`, `DB_VERSION = 2`)
- Modify: `src/drive/merge.ts` (`mergeNotes`), `src/drive/api.ts` (`findCompanionFile`, resumable uploads), `src/drive/library.ts`, `src/drive/test-helpers.ts` (fake: marginalia-tag filter, resumable sessions)
- Test: `src/lib/order.test.ts`, `src/drive/merge.test.ts`, `src/drive/api.test.ts`, `src/drive/library.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `src/types.ts`:

```ts
export type NotesBackground = 'blank' | 'grid' | 'dots' | 'lines'

/** Plain-text paragraph on the notes sheet. */
export interface TextBlock extends Item { kind: 'text'; order: string; text: string }

/** Image on the notes sheet; `w` is its width as a fraction of the sheet width, `aspect` is height / width; `page` links a Snip to its page. */
export interface ImageBlock extends Item { kind: 'image'; order: string; src: string; w: number; aspect: number; page?: number }

export type NoteBlock = TextBlock | ImageBlock

/** Freehand stroke on the notes sheet; points are flat [x, y, pressure] with x and y divided by the sheet width; width is a fraction of the sheet width. */
export interface NoteStroke extends Item { kind: 'ink'; color: string; width: number; points: number[] }

/** One notes file per PDF, stored next to it in Drive as `<name>.marginalia-notes.json`. */
export interface NotesDoc {
  schema: 1
  kind: 'notes'
  pdfId: string
  pdfName: string
  blocks: NoteBlock[]
  strokes: NoteStroke[]
  background: NotesBackground
  backgroundUpdatedAt: number
}

export function emptyNotes(pdfId: string, pdfName: string, now: number): NotesDoc   // background 'blank', backgroundUpdatedAt now
export function isNotesDoc(x: unknown): x is NotesDoc                                 // object, kind 'notes', schema 1, blocks and strokes arrays
```

  `LibraryIndex` gains `notes?: Record<string, DriveNode>` (notes node by PDF id; optional because stored v1 indexes lack it) and `homeArt?: HomeArtFiles`, with `export type HomeArtSlot = 'landscape' | 'portrait' | 'generic'` and `export type HomeArtFiles = Partial<Record<HomeArtSlot, DriveNode>>`.
  - `src/config.ts`: `NOTES_SUFFIX = '.marginalia-notes.json'`; `HOME_ART_FILE = /^marginalia-home(?:-(landscape|portrait))?\.(png|jpe?g|webp)$/i` (capture group 1 is the slot; no group means `generic`).
  - `src/lib/order.ts`: `orderBetween(a: string | null, b: string | null): string` (a key strictly between; `null` is an open end; when `b` is not greater than `a` it is treated as `null`); `compareOrder(x: { order: string; id: string }, y: { order: string; id: string }): number` (by `order` with plain `<` on code units, then `id`).
  - `src/drive/merge.ts`: `mergeNotes(a: NotesDoc, b: NotesDoc): NotesDoc` — blocks and strokes per id with the existing `winner`/`mergeItems` rule (newest `updatedAt`, tombstone wins ties); background and `backgroundUpdatedAt` from the newer `backgroundUpdatedAt`; `pdfName` from the more recently touched doc.
  - `src/lib/idb.ts`: `StoreName` adds `'notes'` (records `{ sidecar: NotesDoc, remoteId?, remoteVersion?, dirty }` — the v1 record field name, so both stores share one shape).
  - `src/drive/api.ts`: `findCompanionFile(pdfId: string, name: string, parentId: string, tag: '1' | 'notes', pdfKey: 'pdf' | 'notesFor'): Promise<DriveNode | null>` (the tagged query is `appProperties has { key='<pdfKey>' and value='<pdfId>' }`, and for notes adds `appProperties has { key='marginalia' and value='<tag>' }`); `findSidecarFile(pdfId, name, parentId)` stays and calls it with `'1', 'pdf'`; `SIMPLE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024` — `createJsonFile`/`updateJsonFile` keep their signatures and use a resumable session (`uploadType=resumable`, metadata request, then `PUT` of the body to the `Location` URL) when the UTF-8 body exceeds it.
  - `src/drive/library.ts`: every existing export keeps its signature (`loadSidecar`, `saveSidecar`, `refreshSidecar`, `flushPendingWrites`, `flushQueue`, `syncLibrary`, `sidecarNameFor`, …; `pullSidecars` stays internal and now pulls both kinds). New: `notesNameFor(pdfName: string): string`; `loadNotes(pdfId: string): Promise<NotesDoc>` (pending edit, else local record, else `emptyNotes(pdfId, name, 0)`); `saveNotes(pdfId: string, doc: NotesDoc): void` (debounced `SIDECAR_SAVE_DEBOUNCE_MS`, its own pending entry); `refreshNotes(pdfId: string): Promise<NotesDoc | null>`. `flushPendingWrites` writes both kinds.

**Library design (decided):** one internal descriptor per kind drives every function that today takes a sidecar:

```ts
interface Companion<T> {
  kind: 'annotations' | 'notes'
  store: 'sidecars' | 'notes'
  tag: '1' | 'notes'
  pdfKey: 'pdf' | 'notesFor'                 // the appProperties key holding the PDF id: lookup, creation and index attach
  nameFor(pdfName: string): string
  queueKey(pdfId: string): string            // annotations: pdfId (v1 queue entries stay valid); notes: `notes:${pdfId}`
  map(index: LibraryIndex): Record<string, DriveNode>   // index.sidecars / index.notes ?? {}
  empty(pdfId: string, pdfName: string): T
  merge(a: T, b: T): T
  accepts(remote: unknown): remote is T      // annotations: has a highlights array; notes: isNotesDoc (also applied to stored records)
  unparseableIsForeign: boolean              // annotations: false (a parse error is a failure); notes: true
  label: string                              // 'annotation' | 'notes', for syncState messages
}
```

`persist`, `writePending`, `locate`, `mergeRemote`, `refresh`, `flushOne`, `pull` take a `Companion`. `pendingSaves` is keyed by `queueKey`. `flushQueue` maps each queue key back to its kind by the `notes:` prefix. The walk and changes code classify a node as notes when `name.endsWith(NOTES_SUFFIX) || appProperties.marginalia === 'notes'`, attach it with the same tag-else-name rule into `index.notes`, and `removeNode`/`prune` cover `notes` and `homeArt`. A non-folder whose parents include the root and whose name matches `HOME_ART_FILE` goes into `index.homeArt[slot]` (two files for one slot: the lowest name by code units); a change that trashes it, removes it or moves it out of the root clears that slot, and an empty `homeArt` becomes `undefined`. When a downloaded remote fails `accepts`, it is not merged: refresh returns `null` and marks the local record dirty and queued; flush uploads the local body over it. Failure messages: annotation wording unchanged; notes `${n} notes download(s) failed` / `${n} notes upload(s) failed`; both kinds failing join with ` · `.

- [ ] **Step 1: Write the failing order and merge tests**

```ts
// src/lib/order.test.ts
test('orderBetween(null, null) is "V" and keys sort with plain string comparison', () => {
  expect(orderBetween(null, null)).toBe('V')
  expect(orderBetween('V', null) > 'V').toBe(true)
  expect(orderBetween(null, 'V') < 'V').toBe(true)
})
test('1000 appends increase, 1000 prepends decrease, and no key ends in "0"', ...)
test('50 inserts between two neighbours stay strictly between and distinct', ...)
test('equal neighbours yield a key after them', () => expect(orderBetween('V', 'V') > 'V').toBe(true))
test('compareOrder breaks equal keys by id', ...)

// src/drive/merge.test.ts
test('mergeNotes keeps the newest block and stroke per id and honours tombstones', ...)
test('mergeNotes keeps blocks two devices inserted concurrently, even with the same order key', ...)
test('mergeNotes takes the newer background', ...)   // a: 'grid'@5, b: 'dots'@9 → 'dots', 9
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/lib/order.test.ts src/drive/merge.test.ts`
Expected: FAIL — `../lib/order` missing, `mergeNotes` not exported.

- [ ] **Step 3: Implement `src/lib/order.ts`, the types, and `mergeNotes`**

Digits `0-9A-Za-z` (base 62, ascending in code units). `orderBetween` normalises (`a ?? ''`, `b` dropped to `null` when `b <= a`) and returns `midpoint(a, b)`:

```ts
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0
    while ((a[n] ?? '0') === b[n]) n++
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n))
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)]
  if (b !== null && b.length > 1) return b.slice(0, 1)
  return DIGITS[da] + midpoint(a.slice(1), null)
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/lib/order.test.ts src/drive/merge.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing sync tests in `src/drive/library.test.ts` (and `api.test.ts`)**

Add `remoteNotes(id, pdfId, parent, doc, tagged = true)` beside `remoteSidecar` (name `${pdfId}.marginalia-notes.json`, `appProperties { marginalia: 'notes', notesFor }`). In `describe('notes')`:

```ts
test('notesNameFor swaps .pdf for .marginalia-notes.json', ...)          // 'Attention.pdf' → 'Attention.marginalia-notes.json'
test('loadNotes returns empty notes for an unseen paper', ...)
test('saveNotes debounces into IndexedDB and flushQueue creates the notes file, then updates it', ...)
  // created file: name, parent, appProperties { marginalia: 'notes', notesFor: 'p1' } and no `pdf` key; second save PATCHes the same id; queue empty
test('the full walk maps notes files to index.notes and never to index.sidecars', ...)  // tagged and name-only
test('refreshNotes finds an unindexed notes file by tag without matching the sidecar', ...)
test('flushQueue merges a notes file that moved remotely before uploading', ...)
test('notes saved offline stay queued in IndexedDB and upload after sign-in', ...)
test('a sidecar edit never re-uploads the notes file', ...)              // no PATCH/PUT whose path holds the notes file id
test('syncLibrary pulls a notes file another device changed', ...)       // loadNotes returns the merged doc
test('a failed notes download does not stop sidecar pulls and is counted', ...)  // message contains '1 notes download(s) failed'
test('a v1 queue entry keyed by the bare PDF id still flushes as a sidecar', ...)
test('a remote notes file that is not a notes document is never merged and gets the local notes', ...)
  // remote content '{"schema":1,"pdfId":"p1","highlights":[]}' (and a second case '{"kind":"no'): refreshNotes → null; flushQueue uploads the local doc; drive.json(id) is the local NotesDoc
test('notes over the simple-upload limit go up through a resumable session', ...)
  // an ImageBlock with a 6 MB src: the upload call has uploadType=resumable, the body goes in a PUT to the session URL, the queue empties
test('records the landscape, portrait and generic home pictures in the root folder only, and clears a slot when trashed', ...)
  // root: marginalia-home-landscape.jpg, marginalia-home-portrait.webp, marginalia-home.png, marginalia-home-square.png; f1/marginalia-home-portrait.png
  // → homeArt { landscape, portrait, generic } are the three root files (the -square and f1 files are ignored); trash the portrait + sync → homeArt.portrait undefined, the others kept
```

`api.test.ts`: `findCompanionFile adds the marginalia tag to the tagged query` (the `q` contains `key='marginalia' and value='notes'`).

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/drive`
Expected: FAIL — `notesNameFor`, `loadNotes`, `saveNotes`, `refreshNotes`, `findCompanionFile` missing; index has no `notes`/`homeArt`.

- [ ] **Step 7: Implement the companion generalisation, the fake's support, idb store, and resumable upload**

As in **Library design** above. `FakeDrive` gains: a `key='marginalia' and value='…'` filter in the files query; `POST/PATCH /upload/drive/v3/files[/id]?uploadType=resumable` answering 200 with `Location: https://upload.fake/session/<n>`; `PUT` to that URL creating or updating the file and answering its metadata. `idb.ts` adds `'notes'` to `STORES` and the in-memory fallback.

- [ ] **Step 8: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass, including every existing `library.test.ts` case unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/config.ts src/lib src/drive
git commit -m "drive: notes companion file synced by the sidecar machinery; fractional order keys; home picture in the index" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Notes sheet UI

**Files:**
- Create: `src/notes/notesStore.ts`, `src/notes/NotesSheet.tsx`, `src/notes/blocks.tsx`, `src/notes/SheetInk.tsx`, `src/notes/images.ts`, `src/notes/notes.css`
- Test: `src/notes/notesStore.test.ts`, `src/notes/NotesSheet.test.tsx`, `src/notes/images.test.ts`

**Interfaces:**
- Consumes (Task 4): `NotesDoc`, `NoteBlock`, `TextBlock`, `ImageBlock`, `NoteStroke`, `NotesBackground`, `emptyNotes`, `orderBetween`, `compareOrder`. Existing: `InkLayer`, `InkStroke`, `newId`, `now`, `showToast` (`src/app/ui.ts`). CSS `var(--font-display, Georgia, serif)` (Task 3).
- Produces:

```ts
// src/notes/notesStore.ts
export interface NotesStore {
  doc: ReadonlySignal<NotesDoc>
  blocks: ReadonlySignal<NoteBlock[]>        // not deleted, sorted by compareOrder
  strokes: ReadonlySignal<NoteStroke[]>      // not deleted
  canUndo: ReadonlySignal<boolean>
  canRedo: ReadonlySignal<boolean>
  addTextBlock(text: string, afterId?: string | null): TextBlock          // undefined: at the end; null: at the start
  addImageBlock(img: { src: string; aspect: number; w?: number; page?: number }, afterId?: string | null): ImageBlock   // w defaults to 0.8
  updateText(id: string, text: string): void                               // consecutive updates of one block are one undo step
  splitText(id: string, offset: number): TextBlock                         // Enter: one undo step
  joinWithPrevious(id: string): { kind: 'text'; id: string; caret: number } | { kind: 'image'; id: string } | null
  resizeImage(id: string, w: number): void                                 // clamps w to [0.15, 1]
  removeBlock(id: string): void
  addStroke(s: NoteStroke): void
  removeStroke(id: string): void
  setBackground(bg: NotesBackground): void                                 // persisted, not undoable
  undo(): void
  redo(): void
  replaceFromRemote(doc: NotesDoc): void                                   // clears history
}
export function createNotesStore(initial: NotesDoc, persist: (doc: NotesDoc) => void): NotesStore

// src/notes/NotesSheet.tsx
export interface NotesSheetHandle { scrollToBlock(id: string): void }
export interface NotesSheetProps { store: NotesStore; onJumpToPage(page: number): void; handle?: (h: NotesSheetHandle) => void }
export function NotesSheet(props: NotesSheetProps): JSX.Element

// src/notes/images.ts
export const IMAGE_LONG_EDGE_PX = 1600
export const JPEG_QUALITY = 0.82
export const IMAGE_MAX_BYTES = 1.5 * 1024 * 1024
export interface Raster { width: number; height: number; hasAlpha: boolean; encode(longEdge: number, type: 'image/jpeg' | 'image/png', quality?: number): Promise<Blob> }
export interface PreparedImage { dataUrl: string; width: number; height: number; bytes: number; mediaType: 'image/jpeg' | 'image/png' }
export class ImageTooLargeError extends Error {}
export function decodeImage(blob: Blob): Promise<Raster>                                          // createImageBitmap + canvas
export function prepareImage(blob: Blob, decode?: (blob: Blob) => Promise<Raster>): Promise<PreparedImage>

// src/notes/SheetInk.tsx
export function SheetInk(props: { width: number; height: number; strokes: NoteStroke[]; onAddStroke(s: NoteStroke): void; onEraseStroke(id: string): void }): JSX.Element
```

Every store mutation stamps `updatedAt`, tombstones removals, and calls `persist(doc)` synchronously. The store never listens to document events (Task 7 routes undo).

**Sheet decisions:** `div.mg-notes[data-bg]` is the scroller; inside it a sticky top-right bar with a `Background` menu button (menu items `Blank`, `Grid`, `Dots`, `Lines`) and a `+ Image` button (hidden `<input type="file" accept="image/*">`); then `div.mg-notes-sheet` (`position: relative`, height = max(pane height, max(blocks bottom, lowest stroke y × sheet width) + pane height)) holding `div.mg-notes-blocks` and `SheetInk` over the whole sheet. Grid, dot and line spacing is 1/25 of the sheet width (CSS var `--sheet-w` set from the measured width), in `--surface` with `--border` lines; night follows the theme. Empty sheet (no non-empty text, no image, no stroke): faint `Write or type your notes`; a tap on the sheet's empty area focuses the last text block's end, or adds one when the last block is an image or there is none. Text block: `div[contenteditable="plaintext-only"].mg-note-text` (the first text block also gets `.mg-note-title`: display serif, larger); its DOM text is set from the store only while it is not focused. Enter (`!e.isComposing && e.keyCode !== 229`, no Shift) → `splitText` at the caret and focus the new block at 0; Backspace with a collapsed caret at 0 → `joinWithPrevious` (text: focus it at `caret`; image: select it). Image block: `figure.mg-note-image` with `img`; tap selects (`data-selected`), showing a bottom-right handle `.mg-note-handle` (drag → `resizeImage((pointerX − blockLeft) / sheetWidth)`) and a bar with `Delete`; Backspace or Delete on the document while an image is selected and no text block is focused removes it; a block with `page` shows `button.mg-note-chip` "p.N" → `onJumpToPage(N)`. Paste with an image file and drop of image files → `prepareImage` → `addImageBlock` after the focused block (else at the end); text paste is left to `plaintext-only`. `ImageTooLargeError` → `showToast('Image too large to add')`. Caret above the keyboard: on `focusin` and `input`, `keepCaretVisible(scroller)` scrolls the scroller by the amount the caret rect's bottom exceeds `visualViewport.offsetTop + visualViewport.height − 16`; a `visualViewport` `resize` listener sets `--kb` (keyboard height) as the scroller's bottom padding. `SheetInk` renders `<InkLayer page={0} cssW={width} cssH={height} …>`, mapping stored y to page-normalised y by `× width / height` (memoised on `[strokes, width, height]`) and committed strokes back by `× height / width`, dropping `page`/`tool`.

- [ ] **Step 1: Write the failing store and image tests**

```ts
// src/notes/notesStore.test.ts
test('adds text blocks in order and persists each change', ...)          // three appends → blocks text order; persist called 3×; orders strictly increasing
test('afterId places a block right after another; null puts it first', ...)
test('splitText at 3 turns "Hello" into "Hel" + "lo" right after it; one undo restores "Hello"', ...)
test('joinWithPrevious appends to the previous text block and returns its caret', ...)   // 'ab' + 'cd' → 'abcd', { kind: 'text', id: first, caret: 2 }; second tombstoned
test('joinWithPrevious after an image selects the image and deletes nothing', ...)
test('consecutive updateText calls on one block undo as one step', ...)
test('resizeImage clamps to [0.15, 1]', ...)
test('removeBlock tombstones and undo restores it; redo removes it again', ...)
test('strokes add, erase, undo and redo', ...)
test('setBackground persists and is not undoable', ...)
test('replaceFromRemote swaps the doc and clears history', ...)
test('ignores the document marginalia:undo event', ...)

// src/notes/images.test.ts — a fake Raster whose encode returns a Blob of size f(longEdge, type)
test('downscales the long edge to 1600 px and encodes JPEG at 0.82', ...)     // 4032×3024 → encode(1600, 'image/jpeg', 0.82); width 1600, height 1200
test('keeps PNG when the image has transparency', ...)
test('steps the size down until it fits 1.5 MB', ...)                          // first encode 2 MB, second at 1200 px 1 MB → bytes 1 MB, width 1200
test('gives up with ImageTooLargeError below 400 px', ...)
test('never upscales a small image', ...)                                      // 300×200 → encode(300, …)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/notes`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `notesStore.ts` and `images.ts`**

The store mirrors `createAnnotationStore`: history entries are lists of `{ collection: 'blocks' | 'strokes'; before?: item; after: item }` (max 100), inverted on undo. `prepareImage`:

```ts
const raster = await decode(blob)
const type = raster.hasAlpha ? 'image/png' : 'image/jpeg'
const long = Math.max(raster.width, raster.height)
let edge = Math.min(IMAGE_LONG_EDGE_PX, long)
for (;;) {
  const out = await raster.encode(edge, type, type === 'image/jpeg' ? JPEG_QUALITY : undefined)
  if (out.size <= IMAGE_MAX_BYTES) return { dataUrl: await dataUrlOf(out), width: Math.round(raster.width * edge / long), height: Math.round(raster.height * edge / long), bytes: out.size, mediaType: type }
  edge = Math.floor(edge * 0.75)
  if (edge < 400) throw new ImageTooLargeError('Image too large')
}
```

`decodeImage` checks alpha only for png, webp and gif sources, on a ≤ 64 px draw.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/notes/notesStore.test.ts src/notes/images.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing sheet tests in `src/notes/NotesSheet.test.tsx`**

Mount `<NotesSheet store={createNotesStore(doc, persist)} onJumpToPage={jump} />` with `vi.mock('./images', …)` so `prepareImage` resolves `{ dataUrl: 'data:image/jpeg;base64,AAAA', width: 800, height: 400, bytes: 3, mediaType: 'image/jpeg' }`; stub `.mg-notes-sheet` `getBoundingClientRect` to `new DOMRect(0, 0, 400, 900)`.

```tsx
test('an empty sheet says "Write or type your notes"', ...)
test('Enter splits the block at the caret and focuses the new one', ...)        // caret at 3 in 'Hello' → texts ['Hel', 'lo'], document.activeElement is the second
test('Enter that confirms an IME composition does not split', ...)              // KeyboardEvent isComposing: true → one block
test('Backspace at the start joins the previous block', ...)
test('the first text block is the title', ...)                                   // first .mg-note-text has .mg-note-title, the second does not
test('+ Image adds an image block from the picked file', ...)                   // input files = [new File(['x'], 'a.png', { type: 'image/png' })] → img src 'data:image/jpeg;base64,AAAA', aspect 0.5
test('dragging the handle resizes the image in sheet units', ...)              // select, handle pointer from x=320 to x=200 → w 0.5
test('a selected image is removed by Delete in its bar and by Backspace', ...)
test('the p.N chip jumps to the page', ...)                                      // block page 4 → jump called with 4
test('the background menu stores the choice in the notes doc', ...)            // choose Grid → store.doc.value.background 'grid', .mg-notes[data-bg="grid"]
test('a pen stroke over the sheet is stored in sheet units', ...)              // pen 40,80 → 200,400 → strokes[0].points [0.1, 0.2, …, 0.5, 1, …]
test('typing keeps the caret above the keyboard', ...)                          // visualViewport { height: 400, offsetTop: 0 }, caret rect bottom 600 → scroller.scrollTop += 216
test('undo and redo act on the sheet store', ...)
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/notes/NotesSheet.test.tsx`
Expected: FAIL — `NotesSheet` missing.

- [ ] **Step 7: Implement `NotesSheet`, `blocks.tsx`, `SheetInk`, `notes.css`**

As in **Sheet decisions**. `blocks.tsx` exports `caretOffset(el: HTMLElement): number` and `placeCaret(el: HTMLElement, offset: number): void` for the Enter and Backspace handling.

- [ ] **Step 8: Run all checks and commit**

Run: `npx tsc -b && npx vitest run && npm run build` — all pass.

```bash
git add src/notes
git commit -m "notes: sheet with text, image and ink blocks, its own undo, background menu" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Snip

**Files:**
- Modify: `src/pdf/gestures.ts` (`useAreaSelect`: armed start in a capture listener)
- Modify: `src/annot/SelectionBar.tsx` (`onCopyImage`, `onToNotes`)
- Modify: `src/app/ui.ts` (`copyImage`), `src/app/icons.tsx` (`snip`)
- Modify: `src/app/Toolbar.tsx` lines 88–101 only (lead hint, Snip button)
- Modify: `src/app/Reader.tsx` line 29 (import `copyImage`), a `toNotes` placeholder inserted before line 283, and the `barHandlers` object at lines 283–326 only
- Test: `src/pdf/Viewer.test.tsx`, `src/annot/SelectionBar.test.tsx`, `src/app/ui.test.ts` (new), `src/app/Toolbar.test.tsx` (new), `src/app/Reader.test.tsx`

**Interfaces:**
- Consumes: existing `PdfDoc.renderCrop`, `IMAGE_MAX_EDGE_PX`.
- Produces:
  - `SelectionBarProps` gains `onCopyImage?(): void` and `onToNotes?(): void` (buttons `Copy image` and `To notes`, shown only when given, after Note); the bar gets `flex-wrap: wrap; max-width: calc(100vw - 16px)`.
  - `src/app/ui.ts`: `copyImage(blob: Blob | Promise<Blob>, filename: string): Promise<'copied' | 'downloaded'>` — `ClipboardItem({ 'image/png': promise })` via `navigator.clipboard.write` when available; otherwise, or when the write rejects, an `<a download={filename}>` click on an object URL.
  - `src/app/icons.tsx`: icon `snip` (scissors).
  - Toolbar: the area button becomes aria-label/title `Snip` with icon `snip`; while armed, the lead shows `<span class="mg-snip-hint" role="status">Drag a box</span>` in place of the title.
  - `Reader.tsx`: `const toNotes = (_page: number, _box: Box): void => undefined` (Task 7 replaces it). For an area selection or an area highlight the bar gets `onCopyImage` (`copyImage(doc.renderCrop(page, box, IMAGE_MAX_EDGE_PX).then((r) => r.blob), \`${title} p${page}.png\`)` → toast `Image copied` or `Image saved`) and `onToNotes` (`toNotes(page, box)`), and no text `onCopy`.
  - Arming rule: `useAreaSelect` adds a capture-phase `pointerdown` listener on the scroller; while `areaSelectArmed` and `e.button === 0`, for any pointer type and any pen tool, it starts the drag and calls `e.stopPropagation()` so the ink layer and text selection never see the pointer. A pen `pointerdown` while a touch-started drag is in progress restarts the drag from the pen. The bubble listener keeps only the touch long-press path, and its `penIgnored` early return no longer applies to armed starts.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/pdf/Viewer.test.tsx
it('an armed Snip takes the next pen stroke as a box even in the Pen tool', async () => {
  const onAddStroke = vi.fn()
  const props = mount({
    areaSelectArmed: signal(true),
    penDrawing: signal(true),
    pageOverlay: (page, w, h) => <InkLayer page={page} cssW={w} cssH={h} strokes={[]} onAddStroke={onAddStroke} onEraseStroke={() => {}} />,
  })
  const span = /* a span appended to page 1's .textLayer */
  pointer('pointerdown', span, { pointerType: 'pen', pointerId: 7, clientX: 60, clientY: 80, buttons: 1 })
  act(() => pointer('pointermove', span, { pointerType: 'pen', pointerId: 7, clientX: 300, clientY: 400, buttons: 1 }))
  await act(async () => pointer('pointerup', span, { pointerType: 'pen', pointerId: 7, clientX: 300, clientY: 400, buttons: 0 }))
  await vi.waitFor(() => expect(props.onSelection).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'area', boxes: [{ x: 0.1, y: 0.1, w: 0.4, h: 0.4 }] })))
  expect(onAddStroke).not.toHaveBeenCalled()
})
it('an armed Snip takes a finger drag', ...)                                    // pointerType touch → kind 'area'
it('a pen landing during a touch-started snip takes the box over', ...)
  // touch down at (10,10) moves to (500,700); pen down at (60,80) → (300,400) up → last selection box { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }

// src/annot/SelectionBar.test.tsx
it('shows Copy image and To notes only when handled, and calls them', ...)

// src/app/ui.test.ts
test('copyImage writes a PNG ClipboardItem', ...)                               // stub ClipboardItem + clipboard.write → 'copied', item type 'image/png'
test('copyImage downloads when the clipboard refuses', ...)                     // write rejects → anchor.download 'x.png' clicked → 'downloaded'
test('copyImage downloads when ClipboardItem is missing', ...)

// src/app/Toolbar.test.tsx (props built with createAnnotationStore(emptySidecar('p1', 'a.pdf', 0), () => {}))
test('Snip arms and disarms, and the lead says "Drag a box" while armed', ...)

// src/app/Reader.test.tsx
test('an area selection offers Copy image and To notes; Copy image renders the crop', ...)
  // doc.renderCrop resolves { blob, mediaType: 'image/png' }; click 'Copy image' → renderCrop called with (1, box, IMAGE_MAX_EDGE_PX); no 'Copy' button
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/pdf/Viewer.test.tsx src/annot src/app/ui.test.ts src/app/Toolbar.test.tsx src/app/Reader.test.tsx`
Expected: FAIL — the pen stroke is drawn instead of boxed; the new buttons and `copyImage` are missing.

- [ ] **Step 3: Implement**

As in **Interfaces**. The existing armed-path behaviour (`flags.areaPointer`, `.mg-dragging`, `setPointerCapture` on the scroller, disarm on release in Reader) is unchanged.

- [ ] **Step 4: Run them to verify they pass, then all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pdf/gestures.ts src/pdf/Viewer.test.tsx src/annot src/app/ui.ts src/app/ui.test.ts src/app/icons.tsx src/app/Toolbar.tsx src/app/Toolbar.test.tsx src/app/Reader.tsx src/app/Reader.test.tsx
git commit -m "snip: one-shot box for any pointer, Copy image and To notes on the bar" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Reader integration and docs

**Files:**
- Modify: `src/app/Reader.tsx`, `src/app/Toolbar.tsx`, `src/app/reader.css`, `src/app/settings.ts`, `src/annot/store.ts`, `src/export/markdown.ts`
- Modify: `README.md`, `docs/testing.md`
- Test: `src/app/Reader.test.tsx`, `src/app/Toolbar.test.tsx`, `src/annot/store.test.ts`, `src/export/markdown.test.ts`

**Interfaces:**
- Consumes: Task 1 `PenStrip`; Task 2 `Puck({ visible })`; Task 4 `loadNotes`, `saveNotes`, `refreshNotes`, `flushPendingWrites`, `NotesDoc`, `compareOrder`; Task 5 `createNotesStore`, `NotesStore`, `NotesSheet`, `NotesSheetHandle`, `prepareImage`, `IMAGE_LONG_EDGE_PX`; Task 6 `toNotes` placeholder, `onToNotes`.
- Produces:
  - `src/annot/store.ts`: `createAnnotationStore(initial: Sidecar, persist: (s: Sidecar) => void, opts: { documentUndo?: boolean } = {})` — `documentUndo: false` skips the document undo/redo listeners (default true keeps v1).
  - `src/app/settings.ts`: `type NotesLayout = 'paper' | 'both' | 'notes'`; `AppSettings.notesLayout: NotesLayout` (default `'paper'`), `AppSettings.splitRatio: number` (default `0.5`).
  - `src/app/Toolbar.tsx`: `interface UndoTarget { canUndo: ReadonlySignal<boolean>; canRedo: ReadonlySignal<boolean>; undo(): void; redo(): void }`; `ToolbarProps` replaces `store` with `history: UndoTarget`, `penCapable` with `touchUi: boolean`, and adds `layout: NotesLayout`, `canLayoutBoth: boolean`, `onLayout(l: NotesLayout): void`. A segmented `role="radiogroup" aria-label="Layout"` with radios `Paper`, `Both` (only when `canLayoutBoth`), `Notes`. With `touchUi` no pen strip; otherwise the Draw latch and its strip as in v1.
  - `src/export/markdown.ts`: `notesToMarkdown(doc: NotesDoc): string` — `''` when there is no non-empty text block and no image; else `## Notes` then, by `compareOrder`, each non-empty text block's text and each image as `(image, p.N)` or `(image)`, joined by blank lines, ending in `\n`.

**Reader decisions:** `touchUi = s.penSeen || isIPadOS() || s.fingerDraws`. `canLayoutBoth` follows `matchMedia('(min-width: 700px)')` live; the effective layout is `notesLayout === 'both' && !canLayoutBoth ? 'paper' : notesLayout`; choosing saves `notesLayout`. Body: `div.mg-panes` (`--split`) with `div.mg-pane.mg-pane-paper` and `div.mg-pane.mg-pane-notes` (both `position: relative`, each with its own scroll), and in Both a `div.mg-divider[role="separator"][aria-orientation="vertical"][aria-label="Resize panes"]`: pointer drag sets `--split` live and saves `splitRatio` on release, clamped so each pane is at least 320 px; ArrowLeft/ArrowRight move it by 0.05. The Viewer is unmounted in the Notes layout and remounted with `initial` from `store.sidecar.peek().reading`; the Viewer's own ResizeObserver refits a fit-width page to the narrower pane. The notes store is created on the first render that shows the sheet (`loadNotes` → `createNotesStore(doc, (d) => { notesEdited = true; saveNotes(pdfId, d) })` → `refreshNotes(pdfId)` → `replaceFromRemote` when non-null); until then the pane shows `Loading notes…`; on unmount, after an edit, `saveNotes(pdfId, notes.doc.peek())`, then the existing `flushPendingWrites()`. The annotation store is created with `{ documentUndo: false }`; `lastPane: Signal<'paper' | 'notes'>` is set by `pointerdown` capture and `focusin` on each pane; the active pane is the visible one, or `lastPane` in Both; the toolbar's `history`, ⌘/Ctrl-Z (outside text fields) and the document `marginalia:undo`/`marginalia:redo` events act on the active pane's store. `<Puck visible={touchUi} />` renders inside the active pane only. `toNotes(page, box)`: ensure the notes store, `doc.renderCrop(page, box, IMAGE_LONG_EDGE_PX)` → `prepareImage(blob)` → `addImageBlock({ src: dataUrl, aspect: height / width, page })` at the end → layout `both` when `canLayoutBoth`, else `notes` → `handle.scrollToBlock(id)`; failures toast `Could not add to notes`. Export appends `notesToMarkdown(notes?.doc.peek() ?? await loadNotes(pdfId))` to the sidecar markdown, separated by a blank line.

- [ ] **Step 1: Write the failing tests**

```ts
// src/annot/store.test.ts
it('documentUndo: false ignores the document undo and redo events', ...)

// src/export/markdown.test.ts
it('notesToMarkdown lists text blocks in order and images as (image, p.N)', () => {
  // blocks (out of array order): text 'Second' order 'c', image page 3 order 'b', text 'First line' order 'a', text '' order 'd', deleted text 'gone' order 'e', image without page order 'f'
  expect(notesToMarkdown(doc)).toBe('## Notes\n\nFirst line\n\n(image, p.3)\n\nSecond\n\n(image)\n')
})
it('notesToMarkdown is empty when there is nothing to export', ...)

// src/app/Reader.test.tsx — the drive mock adds loadNotes, saveNotes, refreshNotes; vi.mock('../notes/NotesSheet') records its props;
// vi.mock('../notes/images') exports IMAGE_LONG_EDGE_PX = 1600 and a prepareImage resolving { dataUrl: 'data:image/jpeg;base64,AAAA', width: 800, height: 400, bytes: 3, mediaType: 'image/jpeg' }; matchMedia stubbed per test; doc.renderCrop resolves a blob
test('the notes file is not read on open; showing Notes loads it', ...)        // loadNotes not called after open; click radio 'Notes' → called with 'p1'
test('Both is offered only from 700 px', ...)
test('a stored Both on a narrow window shows the paper and keeps the setting', ...)
  // settings.notesLayout 'both', (min-width: 700px) false → .fake-viewer present, no .mg-pane-notes, radios Paper and Notes only, settings.notesLayout still 'both'
test('dragging the divider stores the split ratio', ...)                        // panes rect width 1000, drag 500 → 600 → settings.splitRatio 0.6
test('To notes appends the crop as an image block linked to its page and shows the sheet', ...)
  // area selection page 1 → 'To notes' → lastSaved notes block { kind: 'image', page: 1, src: 'data:image/jpeg;base64,AAAA' }; layout 'both'
test('Undo acts on the pane touched last', ...)
  // a highlight on the paper and a text block on the sheet; pointerdown in .mg-pane-notes → Undo removes the block, highlight stays; pointerdown in .mg-pane-paper → Undo removes the highlight
test('Copy as Markdown appends the Notes section', ...)
test('closing after a notes edit queues the notes and flushes', ...)
test('Notes and back returns the paper to where it was', ...)
  // user moves; viewer.props.onReadingPosition({ page: 7, offset: 0.25, zoom: 0 }); Notes → Paper → viewer.props.initial toEqual { page: 7, offset: 0.25, zoom: 0 }; the last saved reading is still page 7
test('pen devices get the puck over the active pane and no pen strip in the toolbar', ...)
  // penSeen true → .mg-pane-paper .mg-puck present, no button[aria-label="Pen"] in .mg-toolbar; default laptop settings → no .mg-puck

// src/app/Toolbar.test.tsx — update the Snip test to the new props; add
test('the layout control offers Both only when allowed and reports the choice', ...)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/app src/annot/store.test.ts src/export`
Expected: FAIL — no layout control, `notesToMarkdown` and `documentUndo` missing.

- [ ] **Step 3: Implement**

As in **Interfaces** and **Reader decisions**; `reader.css` gets the pane, divider and segmented-control rules (the old `.mg-penstrip`/`.mg-swatch` toolbar rules stay for the laptop strip). Update the Toolbar file comment to name the Snip button, layout control and undo target.

- [ ] **Step 4: Run all checks**

Run: `npx tsc -b && npx vitest run && npm run build`
Expected: all pass.

- [ ] **Step 5: Write the docs**

`README.md`: under **Using it**, Snip (button on every device, Copy image, To notes), the notes sheet (Paper · Both · Notes, typing, Pencil, images, background), the tool puck (tap flips Pen ⇄ Eraser, long-press opens the palette), and the home pictures (drop `marginalia-home-landscape.jpg` and `marginalia-home-portrait.jpg` — or `.png` / `.webp` — in the root papers folder; one of them serves both orientations, a plain `marginalia-home.jpg` is the fallback for either; shown in grayscale). Under **Install on iPhone / iPad**: "After updating to v2, delete Marginalia from the home screen and add it again once; iOS reads the status-bar setting only when the app is added." Under **Known limits**: "Apple Pencil Pro squeeze and double-tap do not reach web apps; use the tool puck." and "Ink on the notes sheet stays where it was drawn when text above it reflows."

`docs/testing.md`, **Automated**, one bullet per file: `InkLayer.test.tsx` (live frame equals the committed outline; predicted samples drawn, never stored), `PenStrip.test.tsx`, `settings.test.ts` (pen colour and width round-trip, fallback), `Puck.test.tsx`, `quotes.test.ts`, `homeArt.test.ts`, `Hero.test.tsx`, `index-html.test.ts`, `order.test.ts`, `merge.test.ts` (notes), `library.test.ts` (notes create/locate/merge/offline/isolation/no re-upload/foreign file/resumable; home picture in the index), `notesStore.test.ts`, `images.test.ts`, `NotesSheet.test.tsx`, `Viewer.test.tsx` (armed Snip with pen, finger, palm then pen), `ui.test.ts`, `Toolbar.test.tsx`, `Reader.test.tsx` (layouts, divider, To notes, undo routing, export, Notes and back), `store.test.ts` (`documentUndo`), `markdown.test.ts` (Notes section). **Manual, on device**, new v2 section: remove and re-add the home-screen app, then the top of the screen is solid with no blur on iPhone and iPad and nothing sits under the status bar; Pencil strokes look the same before and after lift at every width and colour; the puck flips Pen ⇄ Eraser with a Pencil tap and opens the palette on long-press, drags along the edge and stays put after relaunch; Snip with the Pencil in the Pen tool, with a finger, and with the palm resting; Copy image pastes into Notes/Messages; To notes lands the crop on the sheet and its p.N chip scrolls the paper; Both on iPad landscape with the divider, Both hidden on iPhone; typing near the bottom of the sheet keeps the caret above the keyboard; a note typed on the iPad appears on the laptop after sync; a sheet with five snips still syncs; the home pictures from Drive appear on every device in grayscale, the iPad switches between the landscape and portrait pictures on rotation, and the drawing comes back when the files are removed.

- [ ] **Step 6: Commit**

```bash
git add src/app src/annot/store.ts src/annot/store.test.ts src/export README.md docs/testing.md
git commit -m "reader: Paper · Both · Notes layouts, puck, undo per pane, To notes, notes in the export" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
