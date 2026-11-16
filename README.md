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
- A short worth-reading note on every new paper: Read, Skim or Skip, and why.
- A map of your papers by topic, with your one-line gist and the links you draw between them.
- An agent terminal on the laptop that works on the open paper (optional, runs on your machine).
- Works offline for cached papers; edits sync through Drive when you are back online.

There is no backend. The app talks to Google Drive and the Anthropic API directly from the browser.
The optional agent host is a small program you run on your own laptop.

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

### Worth reading

Each new paper gets a short note from Claude: a verdict (**Read**, **Skim** or **Skip**) with a
confidence and a reading time, one line on what the paper does, a few topics, then what it does,
why it matters for you, its weak points and where to look first, with page citations. The note is
a Markdown file beside the PDF in Drive, `<paper>.worth-reading.md`, so it is yours like the
sidecar.

- **When:** a paper is graded once, when it first shows up in the folder. Papers that were there
  before v4 are the back catalogue: Settings → Claude → **Grade N ungraded** grades them on request.
- **Where it shows:** a chip on the library row, and the reader's **Verdict** sidebar tab, where
  citations like (p. 4) jump to the page.
- **Regenerating:** nothing rewrites a note on its own. **Regenerate** in the Verdict tab rewrites
  one; after the skill changes, Settings → Claude → **Regenerate M outdated** rewrites the notes
  written with the older skill.
- **Editing:** open the file in Drive and edit it by hand. A device with no unsynced change to that
  note takes the Drive copy on its next sync, so your edit wins.
- **Who grades:** the agent host when it is paired and connected, else this browser with your
  Anthropic key; a host failure falls back to the key. **Grade new papers on this device** in
  Settings → Claude turns grading off for a device.

### Map

**Map** in the library header shows every paper as a dot, grouped round its topics. The colour is
the paper's main topic, the ring its reading status (hollow unread, half reading, full done), and
the lines are the links you drew. Topics come from the worth-reading note until you edit them.

- **Card:** tap a paper for its year, verdict, status, your **gist** (one line, 140 characters),
  the note's one-liner, its topics (add or remove), its links as sentences with an editable
  phrase, and **Open paper**, **Neighbours**, **Link** and **Pin**. The reader's Verdict tab has
  the same gist as **Your gist**, so you can write it right after reading.
- **Layout:** the same papers, topics, links and pins give the same map on every device, and adding
  a paper does not move the others. Drag a paper with the mouse, or press and hold then drag on
  touch, to pin it where you want; **Unpin** returns it to the layout.
- **Links:** select a paper, tap **Link**, tap the other paper, then pick the relation (builds on,
  extends, baseline, contradicts, same problem, related) and an optional phrase.
- **Finding things:** the topic and status chips fade everything else without moving it. Search
  dims what does not match as you type; Enter fits the matches. **Neighbours** shows the papers
  within two links and **Back** returns. Drag, pinch or the wheel pans and zooms; double-tap a
  topic to zoom to it; **Fit** shows everything.
- **Keyboard on the laptop:** `/` searches, the arrows move to the nearest paper in that
  direction, Enter opens it, L starts a link, Esc cancels or clears.

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
- **Bar:** Lasso · Pen · Highlighter · Eraser · Text · Image · Add Page · Thumbnails · Template.
  Ink is stored per page in the page's own width, and strokes, text boxes and images share one
  stacking order per page: whatever you add last sits on top.
- **Lasso:** draw a loop round what you want (or a rectangle, with **Rectangular** on in the tool
  menu); it takes every stroke mostly inside the loop and every text box or image whose centre is
  inside, and a tap on a text box or image selects just that one. The selection gets a dashed frame
  and a menu: **Cut · Copy · Duplicate · Delete · Recolor · Front · Back**, plus **Paste** once
  something is copied; the menu wraps on a narrow page and stays inside the page. Drag inside the
  frame to move it, onto another page too; drag a corner to scale it. With something copied and
  nothing selected, a tap on empty space offers **Paste** there. ⌘C, ⌘X and Delete work on the
  laptop, and ⌘V pastes an image from the system clipboard if it holds one, else the copied items
  where the pointer last was on a page, or in the middle of the page you are looking at; a paste
  always stays on the page. Esc, a tap outside or another tool clears the selection. Copy and paste
  stay inside the app.
- **Text boxes:** pick **Text** and tap a page to drop a box 60 % of the page wide and type; the
  tool stays on Text so the next tap makes another box, and a box you leave empty disappears. Sizes
  **S · M · L** (10 / 13 / 18 pt) and the colour come from the tool menu. Double-tap a box to edit
  it; the Text tool also places new boxes. With the Lasso, tap a box to select it, drag it to move
  it on its page and pull its side handles to change its width; the text reflows.
- **Images:** paste, drop, **Image**, or **To notes** from a Snip; they land on the current page at
  half its width. They are objects like text boxes: the Lasso selects, moves and scales them, and
  a Snip keeps its **p.N** chip.
- **Shapes:** with the Pen or Highlighter, finish a stroke and hold still for half a second; it
  snaps to a line, rectangle, ellipse, triangle or arrow, and moving before you lift turns and
  resizes it. Turn **Draw and hold** off in the Pen's tool menu to keep strokes as drawn.
- **Thumbnails:** shows the pages as a column on the left (a sheet along the bottom on a phone).
  Tap a page to go there; long-press it for **Delete** and **Duplicate**, or long-press and drag to
  move it.
- **v2 notes:** notes from v2 convert into pages the first time they open, the text stacked from
  the top of page 1 and the ink kept where it was drawn.

Undo and Redo act on the pane you touched last. **Copy as Markdown** ends with a Notes section
that lists each page's text and `(image, p.N)` lines.

### Tool menu

A round pill floats over the pane you are working in, on every device. Tap it to flip between Pen
and Eraser; long-press it to expand the tools (Lasso, Pen, Highlighter, Eraser, and Text over the
notebook) and their colour and thickness slots. Tap a slot to pick it and tap the selected slot again to edit it; drag the
pill to any edge to dock it there, and it stays there after a relaunch. The Pencil always uses the
selected tool and a finger never draws unless **Draw with finger** is on in Settings. On the
laptop the mouse draws under Pen, Highlighter and Eraser; **Lasso** or **Esc** stops it, and a
paper always opens in Lasso so a mouse drag selects text. The keys **L**, **P**, **H**, **E** and
**T** pick Lasso, Pen, Highlighter, Eraser and Text outside text fields. On a paper page the Lasso
selects ink only: a drag that starts on the text still selects text, a tap on a highlight still
opens its bar, and the menu has no Front or Back. In night mode Black ink shows pale so
it stays visible; it is still stored as Black.

### Pens

- **Pen types:** Ball, Fountain and Brush. Widths are in millimetres of the page, 0.3 / 0.5 / 0.7
  by default with 0.5 selected, so a line is the same thickness on a paper page and a notebook page.
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

### Agent host

The agent host is a small Node program on the laptop. It runs Claude with the Agent SDK on the
open paper and streams its work into a terminal panel in the reader, and it grades worth-reading
notes while it is connected.

1. Install it once: `npm run host:install`.
2. Give it a key. Put `ANTHROPIC_API_KEY=…` (from the Anthropic Console, the supported way) or
   `CLAUDE_CODE_OAUTH_TOKEN=…` (from `claude setup-token`, a convenience) in
   `~/.config/marginalia/host.env`, then `chmod 600 ~/.config/marginalia/host.env`. A key already
   in the environment works too. Never pass a key on the command line.
3. Start it: `npm run host`. It prints a pairing link ending in `#/pair/<token>`.
4. Open the link in Chrome on the laptop, then tap **Connect** in Settings → Agent host. Chrome
   asks once to let the page reach this device; allow it. The token is kept in
   `~/.marginalia/host-token`; `npm run host -- --new-token` replaces it and unpairs every browser.

Safari cannot reach `localhost` from an HTTPS page, so the terminal is for Chrome on the laptop
only. The iPad and the phone still get the notes the host grades, through Drive.

**The terminal.** With the host connected, the toolbar's **Agent** button opens it. A selected
passage comes along as an attachment. **Esc** stops a turn, `/clear` starts a new session,
`/paper` has the agent read the paper again, `/help` lists the rest. Each session is saved as a
thread in the Threads tab; opening it again resumes the conversation.

**What the agent can reach.**

- It writes only inside the paper's folder under `~/.marginalia/papers/`.
- It reads the paper's folder, the `skills/` folder of this repo, and your own folders: the ones
  named with `--read <dir>` (repeat it for more, e.g. `npm run host -- --read ~/Papers`), else
  `MARGINALIA_READ_DIRS` (colon-separated), else whichever of `~/Documents`, `~/Desktop` and
  `~/ToRead` exist. The host prints the list at start.
- Grep searches only the paper's folder and `skills/`; your folders are reached by listing and
  reading files.
- Private paths are never readable, even inside those folders: `~/.ssh`, `~/.aws`,
  `~/.config/marginalia`, `.env` files, keys and the like.
- It can search and fetch the web. A hostile paper could ask the agent to read files in your
  folders and fetch a URL that carries them, so keep the `--read` folders free of secrets.
- `--allow-bash` turns on shell commands, for chat and for grading. They run without approval and
  outside these rules: they can read and change anything your user can, and your API key or token
  is in their environment. It is off by default, and the host prints a warning while it is on.

The rest of the flags (port, model, effort, where it keeps papers) are in
[`host/README.md`](host/README.md).

## Development

Node lives at `~/.local/node/bin` on the owner's laptop: `export PATH="$HOME/.local/node/bin:$PATH"`.

```bash
npm install
npm run dev       # http://localhost:5173 (copies pdf.js assets to public/pdfjs first)
npx tsc -b        # typecheck
npx vitest run    # unit tests
npm run build     # production build into dist/ (base /marginalia/, includes dist/sw.js)
npm run preview   # serves dist/ at http://localhost:4173/marginalia/
npm run host:install  # installs the agent host's dependencies into host/node_modules (once)
npm run host          # builds and starts the agent host; flags go after `--`
npm run host:check    # typechecks host/ (the root `tsc -b` leaves it out)
```

`npx vitest run` also runs the host's tests (`host/src/*.test.ts`).

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
- Copy and paste in the notebook use an in-app clipboard; nothing goes to or comes from the
  system clipboard except pasted images. An image on the system clipboard, even an older one,
  wins over copied ink on ⌘V; the menu's **Paste** pastes the ink.
- Dragging a lasso selection moves the dashed frame; the items follow at lift.
- A device still on v3 that edits a paper uploads its sidecar without the map fields (gist,
  topics, pin, links). A v4 device that holds a local copy puts them back; if none does, they are
  lost. Reload the iPad and phone apps soon after deploying v4.
- The agent host is reachable from Chrome on the laptop only; Safari cannot reach `localhost`
  from an HTTPS page.
