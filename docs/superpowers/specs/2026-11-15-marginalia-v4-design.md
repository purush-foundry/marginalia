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
whichever runner produced the note. The app compares it to the hash of the SKILL.md it was
built with; a mismatch shows "note from an older skill" with a **Regenerate** button. Nothing
regenerates on its own. **(call)**

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
in this app session. If the device may grade (Settings → "Grade new papers on this device",
default on **(call)**) and a runner is available, they are graded one at a time, newest
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
`gist`, `topics` and `pin` by their `updatedAt`. Topics have no table of their own: the topic
list is the union of every paper's ids, hue = hash of the id, order = the deterministic greedy
chain below. Edges to a paper no longer in the library are hidden, not deleted. No AI edges in
v4; the model is left open (`src` can be added later).

**Layout** (`src/map/layout.ts`, pure, ~200 lines, no dependency): topic-anchored
Fruchterman–Reingold in a 1000×1000 map space.

1. Topic anchors on a circle of radius 360 around the centre, ordered by a greedy chain
   (adjacent topics share the most links; ties by id).
2. Each paper's target = its primary anchor, or the 2:1-weighted mean of its anchors when it
   has several (those papers are the bridges).
3. Start position per paper from `mulberry32(hash32(pdfId))` around its target, so adding a
   paper never moves another paper's start.
4. Per iteration with `k = 0.9·sqrt(1000·1000 / n)`: repulsion `k²/d` between all pairs within
   `2k`; attraction `d²/k · w` along links (w = 1.0 builds-on/extends, 0.8 baseline, 0.6
   same-problem/contradicts, 0.4 related); topic gravity `0.08·(target − pos)`; centre gravity
   `0.01`; pinned papers do not move.
5. 200 iterations, temperature quenching linearly from 100 to `k/8` by iteration 120, then
   constant (FR's quench and simmer); displacement capped by the temperature; clamp to
   [10, 990]; nodes iterated in sorted id order so the result is reproducible.
6. The output is a pure function of (ids, topics, links, pins), cached in the IndexedDB `meta`
   store under a hash of those inputs for instant first paint; an edit warm-starts from the
   cache for 40 simmer iterations so the map nudges rather than jumps.

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

**Tests** (`layout.test.ts`, `MapView.test.tsx`, `merge.test.ts` additions): the layout is
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
<page n="3">…with the selected passage marked <<…>>…</page>
…
</paper>
```

That block is the first text block of the first user turn and carries
`cache_control: { type: 'ephemeral' }`; the question follows as a second block, and follow-up
turns append after it, so every follow-up reads the paper from cache (512-token minimum on the
current models; the API version in `claude.ts` already accepts `cache_control`). The system
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
| `POST /sessions` | `{ pdfId, fresh?: boolean }` → `{ sessionId }`; resumes the paper's stored SDK session unless `fresh` |
| `GET /sessions/:id/events` | SSE stream of the events below |
| `POST /sessions/:id/messages` | `{ text, quote?: { text, page }, image?: <base64 png> }` → queued into the session's input stream |
| `POST /sessions/:id/interrupt` | `query.interrupt()` |
| `POST /verdicts` | `{ pdfId }` → `{ jobId }`; `GET /verdicts/:jobId/events` streams the run and ends with `{ type: 'note', markdown }` |

Every request needs `Authorization: Bearer <token>`; the token is random per host start
(or fixed with `--token`), printed as `https://purush-foundry.github.io/marginalia/#/pair/<token>`
(`--app <origin>` for the dev server). CORS allows only the app's origins (the deployed site
and `http://localhost:5173`); the bearer header makes every request preflighted, so a page on
any other origin cannot drive the host. Chrome asks once for the "loopback network" permission;
the app's first probe runs from a click (Settings → Connect, or the toolbar Agent button) with
`targetAddressSpace: 'loopback'` on every fetch.

Agent configuration per session (`query` with streaming input, one per paper, kept open while
the panel is open; `interrupt`, `setModel` need streaming mode):

- `cwd`: `~/.marginalia/papers/<pdfId>/`; `settingSources: []` so the owner's global CLAUDE.md
  and skills do not leak in; `plugins: [{ type: 'local', path: <repo root> }]` for the skill.
- `systemPrompt: { type: 'preset', preset: 'claude_code', append }` where the append says: you
  are inside Marginalia; the paper's text is `paper.txt` (page-tagged) and the original is
  `paper.pdf`; read `paper.txt` in full before answering about the paper; quote as
  `"words" (p. N)` so the app can jump there; the user's other folders under `$HOME` are
  readable; web search and fetch are allowed; write only inside this folder.
- `tools: ['Read','Glob','Grep','WebSearch','WebFetch','Write','Edit','Skill']` plus `Bash`
  only with `--allow-bash`; `allowedTools` pre-approves the read and web tools by bare name;
  a `PreToolUse` hook denies `Write|Edit|NotebookEdit|Bash` outside the paper folder, and
  `canUseTool` denies anything that reaches it, so the terminal never shows a permission
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
is offered as a chip above the prompt ("Attach: “…” p. 3") and sent as `quote`. Each turn's
user text and final assistant text are saved into the sidecar as a `Thread` with
`anchor: { page: 0, boxes: [] }` (the whole paper) and `model: 'agent'`, so the Threads tab
lists agent conversations ("Whole paper · agent") and they sync; tool lines live only in the
host's session. Below 700 px the panel is the usual bottom sheet.

**Pairing and status.** Route `#/pair/<token>` stores `{ hostUrl: 'http://127.0.0.1:7700',
hostToken }` in settings, replaces the hash, shows a toast. Settings → **Agent host** section:
status line (Not paired / Paired, not reachable / Connected, model, skill hash), a
**Connect** button (the user-gesture probe), **Forget**. A `hostState` signal
(`'off' | 'unreachable' | 'ready'`) drives the toolbar button, the verdict runner choice, and
the Settings line; the app re-probes on focus and every 60 s while `ready`.

### 4. Settings and config additions

- `AppSettings`: `hostUrl`, `hostToken`, `gradeOnThisDevice`.
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
