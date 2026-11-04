# Marginalia

A light PDF paper reader for one person. It runs as a web app and an installable PWA on a laptop
(Chrome), iPhone and iPad (Safari, home-screen app). Your papers live in one Google Drive folder;
Marginalia mirrors that folder tree, caches PDFs on the device, and stores every highlight, ink
stroke, note and Claude thread in a small JSON sidecar next to each PDF
(`<paper>.marginalia.json`), and the notebook in a second file beside it
(`<paper>.marginalia-notes.json`), so nothing is locked in.

- Highlight text in four colours, or an area (equations, figures, tables).
- Draw with the Apple Pencil, or with the mouse under Pen, Highlighter or Eraser.
- Snip a figure or equation to the clipboard or into a notebook that sits beside the paper.
- Ask Claude about a passage or area; answers quote the paper and link back to the page.
- Unread / reading / done badges, outline, highlight list, Copy as Markdown.
- Works offline for cached papers; edits sync through Drive when you are back online.

There is no backend. The app talks to Google Drive and the Anthropic API directly from the browser.

## Google Cloud setup (once)

1. Open <https://console.cloud.google.com/> and create a project (for example "Marginalia").
2. **APIs & Services → Library**: enable the **Google Drive API**.
3. **APIs & Services → OAuth consent screen**:
   - User type **External**.
   - App name, your email as support and developer contact.
   - Scopes: add these two:
     - `https://www.googleapis.com/auth/drive.readonly` (read your papers)
     - `https://www.googleapis.com/auth/drive.file` (create and update the sidecars Marginalia writes)
   - Publishing status: **In production** (click "Publish app"); the app stays unverified, which is
     fine for personal use. If you leave it in **Testing**, add your Google account under
     **Test users**, or Google refuses the sign-in.
   - Privacy policy link (if asked): `https://purush-foundry.github.io/marginalia/privacy.html`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Web application**.
   - Authorized JavaScript origins:
     - `https://purush-foundry.github.io`
     - `http://localhost:5173`
     - `http://localhost:4173` (only if you sign in from `npm run preview`)
   - Authorized redirect URIs:
     - `https://purush-foundry.github.io/marginalia/`
     - `http://localhost:5173/`
     - `http://localhost:4173/marginalia/` (only for `npm run preview`)

   Sign-in works only from an origin listed here; otherwise test against the deployed site.
5. Copy the client id (`….apps.googleusercontent.com`). Either paste it into Marginalia's first
   screen (it is stored on that device), or set `GOOGLE_CLIENT_ID` in `src/config.ts` so every
   device gets it.

**Use the same client id on every device.** `drive.file` write access belongs to the Google Cloud
project that created a file, so a sidecar written under one OAuth client is read-only to another
and its uploads fail ("annotation upload(s) failed").

**The one-time "unverified app" screen.** The first time you connect, Google shows "Google hasn't
verified this app". Click **Advanced → Go to Marginalia (unsafe)**, then allow the two Drive
permissions. This happens once per Google account.

## Using it

1. Open the app, paste the client id if asked, tap **Connect Google Drive**, and pick the Drive
   folder that holds your papers. Subfolders appear as folders in the library.
2. Drop PDFs into that folder from any device; they show up on the next sync (every minute while
   the app is open, on returning to it, or with the sync button).
3. Select text to get the colour bar; tap a highlight to change, note, ask about or delete it.

### Snip

The **Snip** button is in the toolbar on every device. Tap it, then drag a box with whatever
comes next (finger, mouse, or the Pencil in any tool); the lead of the toolbar says "Drag a box"
while it is armed, and Esc or a second tap disarms it. Long-press on a figure on touch works too.
Releasing the box shows the bar: a colour makes an area highlight, **Ask** sends the crop to
Claude, **Copy image** puts a PNG on the clipboard (or downloads it), and **To notes** adds the
crop to the current notebook page at half the page width, with a **p.N** chip that scrolls the
paper back to that page.

### Notebook

Each paper has one notebook. The **Paper · Both · Notes** control in the toolbar picks what is on
screen; **Both** puts the paper on the left and the notebook on the right with a divider you can
drag (or move with the arrow keys), and is offered from 700 px wide. Below 700 px, as on an
iPhone, the control is a single **Notes** toggle that switches between the paper and the notebook.
The layout and the split are remembered per device. The notebook loads the first time you show it.

- **Pages:** fixed-size pages on a grey canvas. **Add Page** adds one **Before**, **After** or
  **Last**; pulling past the last page and letting go adds one too, styled like the last page.
- **Template:** the sheet sets the current page's template (Blank, Ruled narrow, Ruled college,
  Ruled wide, Grid, Dots), colour (White · Yellow · Dark), size (A4 · Letter · Standard) and
  orientation, or all pages with **Apply to all pages**.
- **Zoom:** pinch, or double-tap to switch between fit-width and 200 %; Ctrl-wheel on the laptop.
- **Images:** paste, drop, **Image**, or **To notes** from a Snip; they land on the current page.
- **Tools:** the bar has Lasso · Pen · Highlighter · Eraser; ink is stored per page in the
  page's own width, and a stroke drawn after an image sits above it.
- **v2 notes:** notes from v2 convert into pages the first time they open, the text stacked from
  the top of page 1 and the ink kept where it was drawn.

Undo and Redo act on the pane you touched last. **Copy as Markdown** ends with a Notes section
that lists each page's text and `(image, p.N)` lines.

### Tool menu

A round pill floats over the pane you are working in, on every device. Tap it to flip between Pen
and Eraser; long-press it to expand the tools (Lasso, Pen, Highlighter, Eraser) and their colour
and thickness slots. Tap a slot to pick it and tap the selected slot again to edit it; drag the
pill to any edge to dock it there, and it stays there after a relaunch. The Pencil always uses the
selected tool and a finger never draws unless **Draw with finger** is on in Settings. On the
laptop the mouse draws under Pen, Highlighter and Eraser; **Lasso** or **Esc** stops it, and a
paper always opens in Lasso so a mouse drag selects text. The keys **L**, **P**, **H** and **E**
pick Lasso, Pen, Highlighter and Eraser outside text fields. In night mode Black ink shows pale so
it stays visible; it is still stored as Black.

### Pens

- **Pen types:** Ball, Fountain and Brush. Widths are in millimetres of the page, 0.25 / 0.35 /
  0.5 by default, so a line is the same thickness on a paper page and a notebook page.
- **Highlighter:** 3 / 5 / 8 mm by default; it sits under the ink on dark paper and in night mode,
  and **Draw straight line** keeps only its ends.
- **Eraser:** **Stroke** removes whole strokes and **Segment** cuts out only what it passes over;
  sizes 2 / 4 / 8 mm; filters choose whether it erases pen, highlighter or both; **Auto-deselect**
  returns to the previous tool after each erase.
- **Gestures:** a two-finger double tap undoes and a three-finger double tap redoes.

### Home pictures

Drop `marginalia-home-landscape.jpg` and `marginalia-home-portrait.jpg` (or `.png` / `.webp`) in
the root papers folder to put your own pictures at the top of the library. One of them alone
serves both orientations, and a plain `marginalia-home.jpg` is the fallback for either. They are
shown in grayscale; without them the library shows its drawing.

### Install on iPhone / iPad

1. In **Safari**, sign in to your Google account first (any Google page), so the Drive sign-in
   inside the app is one tap.
2. Open `https://purush-foundry.github.io/marginalia/`.
3. **Share → Add to Home Screen**, then launch Marginalia from the home screen and connect Drive.

iOS 18 or later is required.

After updating to v2, delete Marginalia from the home screen and add it again once; iOS reads the
status-bar setting only when the app is added.

### Claude

Open **Settings → Claude**, paste an Anthropic API key (from <https://console.anthropic.com/>), and
tap **Test key**. The key stays in this device's IndexedDB; it is never written to Drive or put in
a URL. **Forget** removes it. The Fast model answers text questions; the Smart model handles
figures, equations and "think harder".

## Development

Node lives at `~/.local/node/bin` on the owner's laptop: `export PATH="$HOME/.local/node/bin:$PATH"`.

```bash
npm install
npm run dev       # http://localhost:5173 (copies pdf.js assets to public/pdfjs first)
npx tsc -b        # typecheck
npx vitest run    # unit tests
npm run build     # production build into dist/ (base /marginalia/, includes dist/sw.js)
npm run preview   # serves dist/ at http://localhost:4173/marginalia/
```

The service worker (`src/sw.ts`) is built as its own entry; a small plugin
(`src/app/sw-plugin.ts`, wired in `vite.config.ts`) writes the list of built files into `dist/sw.js`
so the app shell works offline. It only handles same-origin requests and never caches Google or
Anthropic calls. In dev no service worker is registered.

The app icons in `public/icons/` and `public/favicon.svg` are generated by
`node scripts/make-icons.mjs`.

Manual, on-device checks are listed in [`docs/testing.md`](docs/testing.md).

## Deploy

```bash
npm run deploy
```

This runs `scripts/deploy.sh`: it builds, then force-pushes `dist/` to the `gh-pages` branch that
GitHub Pages serves at `https://purush-foundry.github.io/marginalia/`. Open apps show
**Update available — Reload** once the new version has downloaded; they never reload on their own.

## Known limits

- Drive v3 has no conditional update, so two devices uploading the same paper's sidecar in the same
  second can still race.
- Three-column papers interleave their columns in text selection and in the text sent to Claude.
- Pages with a `/Rotate` entry render unrotated.
- iOS needs 18 or later.
- Apple Pencil Pro squeeze and double-tap do not reach web apps; use the tool menu.
- Notebook text cannot be edited yet; text converted from v2 notes shows as read-only boxes.
