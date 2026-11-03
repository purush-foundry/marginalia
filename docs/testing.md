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

- [ ] The tool strip (Pen / Eraser / Select + colours) is visible without ever using the Pencil.
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
- [ ] Area select button boxes an equation; the bar appears on release; the button disarms.
- [ ] ⌘/Ctrl-Z undo, ⇧⌘Z redo; Esc closes the bar, then the Ask panel, then the latch.
- [ ] An internal link (citation, figure ref) scrolls and shows "← back to p.N".
- [ ] Install as an app from the address bar; it opens standalone.
- [ ] Settings → Paste fills the Anthropic key and Test key passes.
- [ ] After `npm run deploy`, an open app shows **Update available — Reload** and reloads only
      when tapped.
