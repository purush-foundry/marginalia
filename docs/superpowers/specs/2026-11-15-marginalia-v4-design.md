# Marginalia v4 — worth-reading notes, the brain map, and the paper agent

Owner: Purush. Written 2026-11-15 from the owner's request; every decision not in that request
is marked **(call)** and is the author's, open to correction.

## Intent

Three complaints with the reader as it stands after v3:

1. Every new paper is a blind pick. The owner wants an agent to say, per paper, whether it is
   worth reading, and wants that verdict kept **next to the paper** so it is produced once and
   only redone when the owner changes the rules (a skill file) and asks.
2. Papers read a month ago blur together. The owner wants a **brain map**: one picture of
   everything read, how the papers relate, and a one-line gist per paper in the owner's own
   words so a paper comes back in an instant.
3. Ask Claude only sees the current page. Ask about Section 5 while on page 3 and Claude says
   it is not in its context. The owner wants every paper **fully in context**, an agent that
   can also **read the internet and the laptop's other folders**, and an agent UI that looks
   and behaves like the **Claude Code terminal**.

## Goals

- A `skills/worth-reading/SKILL.md` the owner edits in plain English; its output lands beside
  each PDF as `<paper>.worth-reading.md`, written once per paper, regenerated only on request.
- A map view over the whole library with per-paper gists and typed links, synced like
  everything else (Drive sidecars), usable with a mouse and on the iPad.
- Ask Claude answers from the whole paper on every device. On the laptop, a terminal-style agent
  panel per paper that can search the web, fetch pages, and read other folders on the machine.

## Non-goals

- A hosted service. Marginalia keeps no backend; the new agent host is a process on the
  owner's laptop that only the owner's browser talks to.
- Citation-graph mining (Semantic Scholar, Connected Papers). Links in the map are the owner's
  and the verdict's, not scraped.
- Running the laptop agent from the iPad or iPhone. Safari blocks an HTTPS page from reaching
  `http://localhost` (WebKit bug 171934), so the host is Chrome-on-the-laptop only. Phones and
  iPads keep the direct Ask (now with the whole paper) and direct verdicts.
- Pencil/ink changes, notebook changes.

## Anti-goals

- Regenerating verdicts behind the owner's back. A note is written once; "outdated" is shown,
  never acted on.
- Auto-links that drown the owner's links in the map.
- Leaking secrets: the host token and the Anthropic key never go in URLs that leave the
  machine, Drive files, or logs.

## Constraints (owner's standing rules)

- Web app: no new runtime dependencies (`package.json` is the allowed set). The host is a
  separate package (`host/`) and is the one place a dependency is added: the Claude Agent SDK.
- One-line what-it-does comments. Secrets from settings/env only.
- `npx tsc -b && npx vitest run && npm run build` green before a commit; tests ship with the change.
- Free path over paid: the host uses the Anthropic Console key the owner already pays per use,
  or a Claude Code token (`claude setup-token`) if the owner prefers; nothing new to subscribe to.

## Approaches considered

### Verdict runner

| | Where it runs | Tools | Devices | Verdict |
|---|---|---|---|---|
| A. Host only | Laptop host, Agent SDK with the skill loaded | Web search/fetch, files | Laptop only | Rejected alone: papers dropped from the iPad would wait for the laptop |
| B. Direct only | Browser → Messages API, skill text as the system prompt | None | All | Rejected alone: no web lookups |
| **C. Both, host first (chosen)** | Host when paired and reachable, else direct | As above | All | One skill file drives both; same note format |

Storage: a Markdown file beside the PDF in Drive (`<paper>.worth-reading.md`) **(chosen)** over a
field inside the sidecar JSON (not readable in Drive, bloats every sync) or a host-local file
(not synced, invisible on the iPad).

### Whole-paper context

| | Verdict |
|---|---|
| **A. Send the whole paper, page-tagged, in the first user turn with a cache breakpoint (chosen)** | Simple, works on every device, cross-references resolve, follow-ups read from cache |
| B. Retrieval: pick pages matching the question | Misses "see Section 5" exactly when it matters; more code |
| C. Host agent only | Leaves the iPad with the old behaviour |

A papers of 30–60 pages is 20k–50k tokens; the Haiku/Opus models in `config.ts` have 1M
context. A hard cap of 600k characters keeps a pathological PDF inside limits; the selected
page is always kept.

### Agent transport (browser ↔ host)

| | Verdict |
|---|---|
| **A. HTTP + Server-Sent Events over `fetch` (chosen)** | No server dependency (Node `http`), reuses the SSE parser already in `src/ai/claude.ts`, works with Chrome's loopback permission via `targetAddressSpace: 'loopback'` |
| B. WebSocket | Needs the `ws` package on the host; no benefit for one-way streaming |
| C. Polling | Worse latency, more code |

### Brain map

Research (survey of Obsidian/Logseq graph views, Connected Papers, Inciteful, Litmaps,
CitNetExplorer, Kumu, Heptabase/Scrintal, the Fruchterman–Reingold paper, the "hairball"
literature, Novak's concept maps and the IEEE VIS 2024 study of how researchers browse
citation maps) gives three findings that decide the design: people navigate by **topic
clusters** and remember **bridges** between them; a global force graph becomes a hairball past
~100–200 nodes and reshuffles every session, so no position ever becomes a memory cue; and
memory comes from **propositions** (paper — linking phrase — paper) the owner writes, not from
dots.

| | Verdict |
|---|---|
| **A. Topic-anchored force layout, seeded per paper, owner-typed edges (chosen)** | Clusters by topic, stable between sessions and devices without storing positions, bridges visible, scales to 300 papers |
| B. Free whiteboard (cards with stored positions) | Every new paper needs placing by hand; laptop and iPad layouts diverge; 300 cards is the "crowded desk" |
| C. Timeline (year on x, topic lanes) | 2023–2025 papers pile into two columns; says nothing about complementarity; cheap to add later as a second position function |
| D. Global force graph with AI similarity edges | Similarity edges outnumber the owner's 10:1; the hairball and the reshuffle the literature warns about |

## Design

### 1. Worth-reading notes

**Skill.** `skills/worth-reading/SKILL.md` at the repo root (name `worth-reading`). The repo
root carries `.claude-plugin/plugin.json` (`{ "name": "marginalia" }`) so the Agent SDK loads it
as a local plugin and the host can run it as `/marginalia:worth-reading`. The web app imports
the same file as text (`?raw`) for the direct fallback, so both runners read one prompt. The
skill tells the model what to judge (contribution, novelty, evidence quality, relevance to the
owner's work: bimanual manipulation, VLA policies, imitation learning, real-robot deployment)
and the exact note format below. The owner edits only this file.

**Note format** (`<paper>.worth-reading.md`, Markdown with a front-matter block):

```markdown
---
verdict: read | skim | skip
confidence: high | medium | low
read_time: 45 min
one_line: Trains a bimanual VLA with action chunking and shows it beats ACT on 4 tasks.
topics: [vla, action-chunking, bimanual, real-robot]
year: 2025
venue: CoRL
authors: Smith, Lee, Zhao
skill: 3f9a1c2b4d5e
model: claude-opus-5-5
generated: 2026-11-15T10:21:00Z
---
## Verdict
Read. …two or three sentences…

## What it does
…

## Why it matters (or doesn't) for you
…

## Weak points
…

## Where to look first
- p. 4 Fig. 2 …
```

`skill` is the first 12 hex characters of the SHA-256 of the SKILL.md text, computed by
whichever runner produced the note. The current hash is the paired host's (`/status`) when
it is reachable, else the hash of the SKILL.md the app was built with; a mismatch shows
"note from an older skill" with a **Regenerate** button. Nothing regenerates on its own.
**(call)**

**Topic vocabulary.** The skill carries a short list of topic tags the owner maintains
(initially: `vla`, `imitation-learning`, `diffusion-policy`, `action-chunking`, `bimanual`,
`teleoperation`, `data-collection`, `sim2real`, `tactile`, `grasping`, `world-models`, `rl`,
`vision`, `language`, `evaluation`, `hardware`). The note's `topics` are one to three tags
from that list, primary first; the model may add one new tag only when nothing fits. The
parser does not validate against the list (it is prose in the skill); the map copes with
stray tags (§2). **(call)**

**Storage and sync.** A third companion kind beside annotations and notes:

| | annotations | notes | **verdict** |
|---|---|---|---|
| file | `<p>.marginalia.json` | `<p>.marginalia-notes.json` | `<p>.worth-reading.md` |
| mime | application/json | application/json | text/markdown |
| appProperties | `marginalia=1`, `pdf=<id>` | `marginalia=notes`, `notesFor=<id>` | `marginalia=verdict`, `verdictFor=<id>` |
| IndexedDB store | `sidecars` | `notebooks` | `verdicts` (DB version 4) |
| merge | per item | per item | whole note, newest `generated` wins |

`src/drive/api.ts` grows text-file create/update/download beside the JSON ones (same
multipart/resumable paths, `Content-Type` from the companion). The `Companion` record gains
`mime`, `serialize`, `parse`. Discovery, pull on sync, the upload queue and offline behaviour
come for free from `library.ts`.

**Trigger.** After every `syncLibrary` pass, the app lists papers that have no verdict
companion (index) and no local verdict record, are not already queued, and have not failed
in this app session. Only papers that **arrived after v4 first ran** count as new: each
device stamps `gradingSince` in its settings on first v4 boot and auto-grades papers whose
Drive `modifiedTime` is later **(call: the owner asked for "every time I upload", and grading
the whole back catalogue at Opus prices on day one is a cost decision, not a default)**. The
back catalogue is graded only from Settings → **Grade N ungraded papers**, which shows the
count first. If the device may grade (Settings → "Grade new papers on this device", default
on **(call)**) and a runner is available, new papers are graded one at a time, newest
`modifiedTime` first. A runner is available when the host is paired and reachable, or when an
Anthropic key is set. Grading a paper means: `getPdfBlob` (cached or downloaded) → open with
pdf.js → text of every page → run the skill → parse the front matter (reject and report a note
without a valid `verdict`) → `saveVerdict(pdfId, note)` → upload. Before starting, the app
calls `locate(VERDICT, pdfId)` so a note another device has just uploaded is pulled instead of
duplicated; two devices grading the same paper inside the same minute can still produce two
files, the known Drive race.

**Runners.**

- Host: `POST /verdicts { pdfId }` after the paper has been uploaded to the host (see §3).
  The host runs a one-shot `query({ prompt: '/marginalia:worth-reading', options })` in the
  paper's folder with `tools: ['Read','Grep','Glob','WebSearch','WebFetch','Skill']` and
  streams the same events as a session; the final assistant text is the note. The host
  validates the front matter before returning.
- Direct: `streamMessage` from `src/ai/claude.ts` with `system = SKILL.md body + "Paper
  follows"` and the page-tagged paper as the user turn; model = the Smart model (the Opus
  default). Output parsed the same way.

**UI.**
- Library row: a chip after the reading badge — **Read** (accent), **Skim** (muted), **Skip**
  (struck, muted); none while ungraded; a small spinner while grading.
- Reader sidebar: a fourth tab **Verdict** with the note rendered by the existing Markdown
  renderer, the generated line ("opus 5.5 · skill 3f9a1c2b · 15 Nov"), **Regenerate**, and
  "older skill" when outdated.
- Settings → Claude: "Grade new papers on this device" toggle; "Regenerate N outdated notes"
  button (runs the queue for notes whose `skill` differs); the current skill hash.

### 2. Brain map

**Data** lives in the existing per-paper sidecar so sync and merge come for free **(call,
over a root-level map file, which would need its own sync path)**. `Sidecar` gains:

```ts
gist?: { text: string; updatedAt: number }        // the owner's one line, ≤ 140 chars
topics?: { ids: string[]; updatedAt: number }     // topic ids, [0] primary; prefilled from the verdict's `topics`, owner-editable
pin?: { x: number; y: number; updatedAt: number } // map-space position after a deliberate drag; absent = simulated
links: PaperLink[]                                // edges stored on the `from` paper
```

```ts
interface PaperLink extends Item {
  kind: 'link'
  to: string                                                   // pdfId
  rel: 'builds-on' | 'extends' | 'baseline' | 'contradicts' | 'same-problem' | 'related'
  note?: string                                                // the linking phrase: "replaces the diffusion head with flow matching"
}
```

`builds-on`, `extends`, `baseline` are directed (from = the newer paper). `contradicts`,
`same-problem`, `related` are symmetric and stored on the lexically smaller pdfId so each
edge has one home. `mergeSidecars` merges `links` per item like highlights and takes the newer
`gist`, `topics` and `pin` by their `updatedAt`. A paper's topics are **derived at render
time**: `sidecar.topics` when the owner has set them, else the verdict note's `topics`;
regenerating a note never touches the sidecar **(call)**. Topics have no table of their own:
the topic list is the union of every paper's ids, hue = hash of the id, order = the
deterministic greedy chain below. Edges to a paper no longer in the library are hidden, not
deleted. No AI edges in v4; the model is left open (`src` can be added later).

Existing sidecars have none of these fields, so all four stay optional and `schema` stays 1.
A device still on v3 that edits a sidecar (every open updates the reading position) uploads
it without the v4 fields; the v4 device merges that with its local copy, where the fields win
by `updatedAt`, and uploads them back. The fields are lost only if no v4 device holds a local
copy, so reload the iPad and phone apps soon after the deploy **(call: accepted window;
README known limit)**.

**Layout** (`src/map/layout.ts`, pure, ~200 lines, no dependency): topic-anchored
Fruchterman–Reingold in a 1000×1000 map space.

1. Topic anchors on a circle of radius 360 around the centre, one per topic that is the
   **primary** topic of at least one paper (so stray secondary tags never add anchors),
   ordered by a greedy chain (adjacent topics share the most links; ties by id).
2. Each paper's target = its primary anchor, or the 2:1-weighted mean of its anchored topics
   when it has several (those papers are the bridges). A paper with no topics (ungraded, no
   owner tags) has no target and feels only the centre gravity, so it floats in the middle
   until it is graded or tagged.
3. Start position per paper from `mulberry32(hash32(pdfId))` within `0.12·size` of its target
   (the centre when it has none), so adding a paper never moves another paper's start.
4. Per iteration with `k = min(0.9·sqrt(1000·1000 / n), 60)` (the cap lets a small library
   cluster instead of filling the canvas): repulsion `k²/d` between all pairs within `2k`;
   attraction `d²/k · w` along links (w = 1.0 builds-on/extends, 0.8 baseline, 0.6
   same-problem/contradicts, 0.4 related); topic gravity `0.3·(target − pos)`; centre gravity
   `0.05`; pinned papers do not move. **(call, revised during the build: the first constants
   let repulsion push edgeless papers to the canvas edge.)**
5. 200 iterations, temperature quenching linearly from 100 to `k/8` by iteration 120, then
   constant (FR's quench and simmer); displacement capped by the temperature; clamp to
   [10, 990]; nodes iterated in sorted id order so the result is reproducible.
6. A device's first layout is a pure function of (ids, topics, links, pins). It is cached in
   the IndexedDB `meta` store under a hash of those inputs for instant first paint; when the
   inputs change, the layout warm-starts from that device's previous positions for 40 simmer
   iterations so the map nudges rather than jumps. Positions therefore depend on each device's
   history, and two devices can differ slightly; a pin fixes a paper's place on every device.
   **(call, final review: the warm start stays for on-device stability; cross-device identity
   is given up.)**

**View** (`#/map`, `src/map/MapView.tsx`, SVG): one layer each for topic hulls (a soft circle
round each topic's members with the topic name as a large label readable at every zoom),
links, nodes, labels. Node = circle in the topic hue, ring = reading status (hollow unread,
half reading, full done), radius 6 + 2·sqrt(links); stroke lightness by year (older paler).
Labels (first four words of the title) appear at zoom ≥ 0.8; the selected node and hubs are
always labelled. Link styles: builds-on/extends solid with an arrowhead, baseline dotted with
an arrowhead, contradicts dashed in a warm hue, same-problem thin solid, related thin at 40 %.
No edge text on the canvas; the linking phrase shows on hover/tap and in the card.

**Interactions** (mouse and touch):

- Pan: drag on empty canvas; zoom: wheel, pinch, double-tap a hull to zoom to it; a Fit button.
  The viewport is per device and not stored.
- Tap a node → side card (right panel on laptop and iPad landscape, bottom sheet on phones):
  title · authors · year · verdict chip · status · the **gist** editor (saves on blur to the
  sidecar) · the verdict's one line · topic chips (add/remove) · links as sentences ("builds
  on *Diffusion Policy* — replaces DDPM with flow matching", each with its own note editor
  and delete) · **Open paper** · **Neighbours** · **Link** · **Pin/Unpin**.
- Drag a node: mouse drag; on touch press 300 ms then drag (a plain drag pans). Dropping
  writes `pin`; a small pin glyph shows; Unpin returns it to the simulation.
- Link: select A → **Link** → the canvas dims and A pulses → tap B → a sheet with the six
  relations (directed ones show "A → B" with a swap) and the phrase field → save. The same
  path works with a mouse; no connector handles.
- Filter chips (topics, status); non-matching nodes and links fade to 15 % and never move.
  Search (`/` on the laptop) matches title, gist, topics and link phrases, dims the rest and
  zooms to the best hit.
- **Neighbours** dims everything beyond two hops and fits the viewport to the rest; Back
  returns to the previous viewport. **(call: instead of a separate radial layout, so
  positions stay stable.)**
- Keyboard on the laptop: arrows walk linked papers, Enter opens, L starts link mode, Esc
  cancels or clears.

**Entry points.** A **Map** button in the library header; the sidebar's paper card in the
reader has a "Gist" field too (the same `gist`), so a line can be written right after reading.
The map excludes nothing by default; a "read only" filter (status done) is one tap.

**Tests** (`layout.test.ts`, `MapView.test.tsx`, `merge.test.ts` additions): a cold layout is
deterministic and stable when a paper is added; pinned nodes do not move; topic order is the
greedy chain; a link saves on the right paper with the right direction; symmetric links land
on the smaller id; gist saves to the sidecar; merge keeps the newer gist and unions links;
filter dims without moving; the card opens from a tap.

### 3. The paper agent

**3a. Whole paper in the direct Ask (all devices).** `buildRequest` in `src/ai/context.ts`
changes from one page to the whole paper:

```
Paper: <title>
<paper pages="12">
<page n="1">…</page>
…
</paper>
```

That block is the first text block of the first user turn, is **identical for every thread
on the paper** (no selection marks inside it) and carries `cache_control: { type: 'ephemeral'
}`, so follow-ups in a thread and new threads on the same paper within five minutes all read
the paper from cache (512-token minimum on the current models; the API version in
`claude.ts` already accepts `cache_control`). The second block is the selection: the anchor
page's text again with the passage marked `<<…>>` (one page, cheap), or the "not found
verbatim" line, or the area line; then the crop image if any; then the question. The system
prompt now says the whole paper is provided and that cross-references ("Section 5", "Eq. 3",
"Fig. 2") should be resolved by reading that part and quoting it with its page. The status
line becomes "Sending the whole paper (12 pages) + image". `AskPanelProps.getPageText`
becomes `getPaperText(): Promise<PageText[]>` (Reader loads all pages once per paper and
caches the promise). Papers over 600k characters are cut from the end with a note, keeping the
selected page.

**3b. The host (laptop).** A new package `host/` (own `package.json`, dependency
`@anthropic-ai/claude-agent-sdk`, Node 22, TypeScript compiled with the root `tsc` into
`host/dist`, run with `npm run host` from the repo root). It binds `127.0.0.1:7700` (flag
`--port`), prints a pairing URL once, and serves:

| Route | Does |
|---|---|
| `GET /status` | `{ version, model, skill: <hash>, auth: 'api-key' \| 'oauth-token' \| 'none', cwd }` |
| `PUT /papers/:pdfId` | Body: `{ name, title, pages: [{ n, text }], pdf: <base64> }` → writes `~/.marginalia/papers/<pdfId>/paper.pdf`, `paper.txt` (page-tagged), `meta.json` |
| `POST /sessions` | `{ pdfId, sessionId?: string, fresh?: boolean }` → `{ sessionId }`; resumes the given SDK session, else the paper's stored one, unless `fresh` |
| `GET /sessions/:id/events` | SSE stream of the events below |
| `POST /sessions/:id/messages` | `{ text, quote?: { text, page }, image?: <base64 png> }` → queued into the session's input stream |
| `POST /sessions/:id/interrupt` | `query.interrupt()` |
| `POST /verdicts` | `{ pdfId }` → `{ jobId }`; `GET /verdicts/:jobId/events` streams the run and ends with `{ type: 'note', markdown }` |

Every request needs `Authorization: Bearer <token>`; the token is generated on the first
start, kept in `~/.marginalia/host-token` (mode 0600) and reused, so pairing happens once
(`--token` overrides, `--new-token` rotates) **(call)**. It is printed as
`https://purush-foundry.github.io/marginalia/#/pair/<token>` (`--app <origin>` for the dev
server). A 401 puts the app's host state at `unauthorised` ("Token rejected — pair again"). CORS allows only the app's origins (the deployed site
and `http://localhost:5173`); the bearer header makes every request preflighted, so a page on
any other origin cannot drive the host. Chrome asks once for the "loopback network" permission;
the app's first probe runs from a click (Settings → Connect, or the toolbar Agent button) with
`targetAddressSpace: 'loopback'` on every fetch.

Agent configuration per session (`query` with streaming input, one per paper, kept open while
the panel is open; `interrupt`, `setModel` need streaming mode):

- `cwd`: `~/.marginalia/papers/<pdfId>/`; `settingSources: []` so the owner's global CLAUDE.md
  and skills do not leak in; `plugins: [{ type: 'local', path: <repo root> }]` for the skill.
- `systemPrompt: { type: 'preset', preset: 'claude_code', append }` where the append says: you
  are inside Marginalia; the whole paper was given in the first message, page-tagged; the
  same text is in `paper.txt` and the original PDF in `paper.pdf` for Grep or a second look;
  quote as `"words" (p. N)` so the app can jump there; the user's other folders under `$HOME`
  are readable except private configuration; web search and fetch are allowed; write only
  inside this folder.
- `tools: ['Read','Glob','Grep','WebSearch','WebFetch','Write','Edit','Skill']` plus `Bash`
  only with `--allow-bash`; `allowedTools` pre-approves the read and web tools by bare name;
  one `PreToolUse` hook is the fence: it denies `Write|Edit|NotebookEdit|Bash` outside the
  paper folder **and denies `Read|Glob|Grep` on private paths** (`~/.ssh`, `~/.aws`,
  `~/.gnupg`, `~/.kube`, `~/.docker/config.json`, `~/.netrc`, `~/.config/gcloud`,
  `~/.config/marginalia`, `~/.claude`, `~/.claude.json`, `~/.marginalia/host-token`,
  `~/.marginalia/sessions.json`, any path segment `.env`, any file ending `.pem` or `.key`),
  so a paper carrying injected instructions cannot read a key and put it in a fetch URL;
  `canUseTool` denies anything else that reaches it, so the terminal never shows a permission
  prompt. **(call)**
- `model: 'claude-opus-5-5'` (the SDK default when unset), `effort: 'medium'`,
  `includePartialMessages: true`, `maxTurns: 40`, `maxBudgetUsd: 2` per turn batch **(call)**.
- Session ids are stored in `~/.marginalia/sessions.json` keyed by `pdfId`; `/clear` in the
  panel starts a fresh one.
- The first user turn of a new session carries the whole page-tagged paper (same text as 3a),
  so the paper is in context even before the agent reads a file.

Events on the SSE stream, normalised from `SDKMessage` so the browser never sees SDK types:

```
{ type: 'turn_start' }
{ type: 'text', delta: '…' }                                   // assistant text, token by token
{ type: 'tool_start', id, name, input }                        // one per tool_use block
{ type: 'tool_end', id, ok: boolean, summary: 'Read 412 lines' } // from the matching tool_result
{ type: 'status', text: 'Thinking…' }                          // spinner words
{ type: 'turn_end', costUsd, durationMs, numTurns }            // from the result message
{ type: 'error', message }
```

**3c. The terminal panel (browser).** `src/agent/Terminal.tsx` replaces the Ask panel's slot
(`.mg-ask-wrap`, widened to 460 px on wide screens **(call)**) when opened from a new toolbar
button **Agent** (terminal icon), shown only while a host is paired and reachable. It is
styled as a dark terminal regardless of night mode: `var(--mono)` 13 px, near-black
background, the Claude Code glyphs and layout:

```
 ✻ Marginalia agent · Attention Is All You Need          opus 5.5 · host 0.1.0

 > how does eq 3 relate to the ablations in section 5?

 ⏺ I'll check both parts of the paper.

 ⏺ Read(paper.txt)
   ⎿  Read 412 lines

 ⏺ Grep(pattern: "Section 5")
   ⎿  Found 4 matches

 ⏺ Equation 3 defines the scaled dot-product … "we scale the dot products by 1/√dk"
   (p. 4) … The ablation in Table 3 row (B) "varying the attention key size" (p. 9) …

 ✻ Thinking… (4s · esc to interrupt)

 ╭──────────────────────────────────────────────────────────────╮
 │ >                                                            │
 ╰──────────────────────────────────────────────────────────────╯
   ↑ history · / commands · esc interrupt            turn $0.04 · session $0.31
```

Behaviour: Enter sends, Shift-Enter newlines, ↑/↓ walk the input history, Esc interrupts a
running turn, `/clear` starts a fresh session, `/model opus|sonnet|haiku` switches, `/paper`
re-sends the paper, `/help` lists these. Tool lines collapse to one `⎿` summary; clicking
expands the input. Assistant text renders through the existing Markdown renderer so
`"quote" (p. N)` citations stay clickable and jump the paper. The current selection, if any,
is offered as a chip above the prompt ("Attach: “…” p. 3") and sent as `quote`. One
`Thread` per host session: `anchor: { page: 0, boxes: [] }` (the whole paper), `model:
'agent'`, and a new optional `session` field holding the SDK session id; each turn's user
text and final assistant text are appended to it, so the Threads tab lists agent
conversations ("Whole paper · agent") and they sync. Reopening the panel re-renders the
Thread's turns (no tool lines; those live only in the host's session) and resumes its
session by id; `/clear` starts a new Thread and a fresh session. On a device without a host
(iPad, phone), opening an agent thread shows the same transcript read-only with the prompt
replaced by "Pair the agent host on the laptop to continue". Below 700 px the panel is the
usual bottom sheet.

**Pairing and status.** Route `#/pair/<token>` stores `{ hostUrl: 'http://127.0.0.1:7700',
hostToken }` in settings, replaces the hash, shows a toast. Settings → **Agent host** section:
status line (Not paired / Paired, not reachable / Token rejected — pair again / Connected,
model, skill hash), a **Connect** button (the user-gesture probe), **Forget**. A `hostState`
signal (`'off' | 'unreachable' | 'unauthorised' | 'ready'`) drives the toolbar button, the
verdict runner choice, and the Settings line; the app re-probes on focus and every 60 s while
`ready`.

### 4. Settings and config additions

- `AppSettings`: `hostUrl`, `hostToken`, `gradeOnThisDevice`, `gradingSince` (ms, stamped on
  the first v4 boot of the device).
- `Thread.session?: string` in `src/types.ts`.
- `config.ts`: `VERDICT_SUFFIX = '.worth-reading.md'`, `HOST_DEFAULT_URL`, `PAPER_CONTEXT_MAX_CHARS`.
- `.env.example` is not used by this app; the host documents `ANTHROPIC_API_KEY` /
  `CLAUDE_CODE_OAUTH_TOKEN` in `host/README.md` and reads them from its environment or from
  `~/.config/marginalia/host.env` (KEY=value lines) so the key never goes on a command line.

## Testing

Unit (vitest, happy-dom), with the change:

- `context.test.ts`: whole paper page-tagged, selection marked on its page, cache_control on
  the paper block only, the 600k cap keeps the selected page, follow-ups leave the first block
  byte-identical.
- `verdict.test.ts`: front-matter parse/serialise round trip, invalid notes rejected, skill
  hash stable, "outdated" detection.
- `library.test.ts` additions with `FakeDrive`: a `.worth-reading.md` beside a PDF is attached,
  pulled, and shown; a locally generated note uploads as text/markdown with the tags; newest
  `generated` wins a merge.
- `grader.test.ts`: the queue picks ungraded papers newest first, one at a time, skips failed
  ones for the session, prefers the host, falls back to direct, honours the device toggle.
- `host/src/*.test.ts` (SDK mocked by a fake `query` generator): SDK messages → normalised
  events, SSE framing, bearer + CORS rejection, write-fence hook decisions, verdict validation,
  session store round trip.
- `Terminal.test.tsx`: a scripted event stream renders prompt, ⏺ text, tool lines with ⎿
  summaries, status spinner, cost line; Esc posts interrupt; `/clear` requests a fresh session;
  turns persist as a Thread.
- Map tests per §2.
- `Library.test.tsx`: the verdict chip from a local note.

On-device checks go in `docs/testing.md` (Chrome loopback prompt on first Connect; a paper
graded from the iPad appears on the laptop; the terminal on a 13" laptop; the map on iPad).

## Rollout

- DB version 3 → 4 (adds the `verdicts` store); like v3, a device that opens v4 cannot go back.
- Deploy with `npm run deploy` after the checks; the host is started by hand on the laptop
  (`npm run host`) and paired once.

## Left to the builder

- Exact CSS of the terminal (colours for ⏺ success/error, dim ⎿ lines, the spinner's word list).
- The SSE keep-alive interval and reconnect backoff.
- How the Library decides "newest first" when `modifiedTime` ties.
- Markdown renderer additions needed for the note (tables stay unsupported).

## Decisions during the build

- **Read fence is an allowlist.** The agent reads only the paper's folder, the repo's `skills/` and
  owner folders (`--read`, else `MARGINALIA_READ_DIRS`, else `~/Documents`, `~/Desktop`,
  `~/ToRead`), with the private-path denylist applied inside and unknown tools denied; a denylist
  alone was bypassable.
- **Verdict runs get no owner folders.** Grading runs unattended on any PDF that lands in Drive,
  so it reads only the paper's folder and `skills/`; the skill needs only the web tools.
- **Grep roots are the paper's folder and `skills/` only.** The CLI's Grep always searches hidden
  files, so in an owner folder it would return `.env` and key contents; owner folders stay
  reachable through Glob and Read, which check each file.
- **`--allow-bash` runs Bash unfenced and auto-approved.** It is an explicit opt-in; the host warns
  at start and the README states the consequences.
- **Automatic grading covers new papers only.** Papers older than the device's `gradingSince` are
  the back catalogue, graded from Settings on request, so the first v4 launch does not grade the
  whole library.
- **A clean device takes the Drive copy of a note (`preferRemoteWhenClean`).** Merging on equal or
  older `generated` kept the local copy, so a hand edit in Drive never showed; a dirty local note
  still merges by `generated`.
- **The host's skill hash is authoritative while it is connected.** Notes compare against it and
  host-graded notes are stamped with it; without the host the bundled skill's hash is used.
- **An ended session is reopened by resuming its id.** The server treats an ended `Session` as
  absent, so closing and reopening the panel restores the conversation instead of needing
  `/clear`.
- **Agent threads carry `Thread.session`.** The saved thread holds the SDK session id the host
  was given, so opening the thread again resumes that session.
- **`/paper` sends a re-read instruction.** The agent re-reads the paper from its folder instead of
  the browser sending 600k characters through a message.
- **Map search fits on Enter.** Typing dims the non-matches and Enter fits all matches, rather than
  zooming to the best hit, because the match set is the useful unit.
- **Authors are not on the map card.** `MapNode` has no authors; the card already carries title,
  year and verdict.
- **Layout constants were revised** (start radius, `k` cap, gravities); §2 already carries the
  built values.
