# Marginalia v4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three v4 features: worth-reading notes written by a skill and kept beside each PDF, a brain map of the library with gists and typed links, and a paper agent that has the whole paper in context (every device) plus a Claude-Code-style terminal backed by a laptop host with web and filesystem tools.

**Architecture:** The web app stays a no-backend Preact PWA; new state goes into the existing Drive companion/sidecar machinery (a third companion kind for verdict notes, new sidecar fields for the map). A separate `host/` package wraps the Claude Agent SDK behind a localhost HTTP+SSE server the browser talks to with a bearer token; the browser never sees SDK types, only the small `HostEvent` protocol. Parts A–D are independent after the foundation task and can be built in parallel worktrees; Part E integrates.

**Tech Stack:** Preact 11 + @preact/signals, TypeScript 7, Vite 8, vitest + happy-dom, pdfjs-dist; host: Node 22, `@anthropic-ai/claude-agent-sdk` 0.3.x, bundled by Vite SSR mode.

**Spec:** `docs/superpowers/specs/2026-11-15-marginalia-v4-design.md`

## Global Constraints

- Web app: no runtime dependency beyond `package.json`'s current four; the host (`host/package.json`) may depend only on `@anthropic-ai/claude-agent-sdk`.
- Node is at `~/.local/node/bin`: prefix commands with `export PATH="$HOME/.local/node/bin:$PATH"`.
- Before every commit: `npx tsc -b && npx vitest run && npm run build` green (host tasks also `npm run host:check`).
- Comments: one line, what the code does. No dates, history, constants or justifications.
- Secrets (host token, Anthropic key) only in IndexedDB settings or the host's environment; never in URLs that leave the machine, Drive files, logs or source.
- Verdict note file name `<paper>.worth-reading.md`; skill file `skills/worth-reading/SKILL.md`; host port 7700; map space 1000×1000; paper context cap 600 000 characters.
- Default model ids: text `claude-haiku-5-5`, smart/vision `claude-opus-5-5` (from `src/config.ts`); host model `claude-opus-5-5`, effort `medium`.
- Commit after each task with a one-line `area: what it does` message.

## Review Focus

1. A PDF whose text layer is empty (scanned paper): `paperBlock` sends empty pages and the grader must produce a note that says so rather than crash — Task A1 test "empty pages stay tagged", Task B4 test "a paper with no text is graded with the skill's 'no text' rule".
2. A verdict file in Drive edited by hand to broken front matter: it must be reported, not re-generated and not treated as foreign and overwritten — Task B3 test "an unparseable note is kept and reported".
3. Two papers linked and then one deleted from Drive: the map must not crash and the dangling link must be hidden — Task C2 test "edges to missing papers are dropped from the graph".
4. The host dies mid-turn: the terminal must show an error line and re-enable the prompt, and the grader must fall back to direct on the next pass — Task D4 test "a dropped stream ends the turn with an error", Task D6 test "host failure falls back to direct".
5. A page from another origin posting to the host: must be refused by CORS/preflight and the bearer check — Task D2 test "requests without the bearer or from another origin get 401/403".

---

## File structure

| Path | Responsibility |
|---|---|
| `src/ai/context.ts` | Whole-paper request builder (`paperBlock`, `buildRequest`) |
| `src/lib/sse.ts` | SSE parser moved out of `claude.ts`, shared with the host client |
| `src/verdict/note.ts` | `VerdictNote` type, front-matter parse/serialize, outdated check |
| `src/verdict/skill.ts` | Bundled SKILL.md text, body extraction, SHA-256 hash |
| `src/verdict/runner.ts` | `paperInput` (PDF → pages) and the direct Messages-API grader |
| `src/verdict/grader.ts` | The grade-new-papers queue and regenerate actions |
| `src/verdict/VerdictChip.tsx`, `VerdictTab.tsx`, `verdict.css` | Library chip, sidebar tab |
| `src/map/data.ts` | Pure sidecar edits for gist/topics/pin/links + `updateSidecar` |
| `src/map/model.ts` | Graph built from the library (`loadGraph`, topic order, canonical links) |
| `src/map/layout.ts` | Deterministic topic-anchored force layout |
| `src/map/viewport.ts` | Pan/zoom transform for pointer, wheel, pinch |
| `src/map/MapView.tsx`, `Card.tsx`, `LinkSheet.tsx`, `map.css` | The map screen |
| `src/agent/host.ts` | Host client: settings, probe, sessions, SSE stream, verdict run |
| `src/agent/transcript.ts` | `HostEvent` → terminal lines reducer |
| `src/agent/Terminal.tsx`, `terminal.css` | The Claude-Code-style panel |
| `host/src/protocol.ts` | `HostEvent` and request/response types shared with the browser |
| `host/src/events.ts` | SDK messages → `HostEvent` |
| `host/src/fence.ts` | Write fence hook + `canUseTool` |
| `host/src/papers.ts` | Paper folder + `sessions.json` on disk |
| `host/src/agent.ts` | The only SDK importer: sessions and one-shot verdict runs |
| `host/src/server.ts` | HTTP routes, CORS, bearer, SSE |
| `host/src/main.ts` | Flags, env file, pairing printout |
| `skills/worth-reading/SKILL.md`, `.claude-plugin/plugin.json` | The skill and the plugin manifest the SDK loads |

---

## Part 0 — Foundations (one task, before the fan-out)

### Task 0: Shared types, config, routes, settings, DB version

**Files:**
- Modify: `src/types.ts`, `src/config.ts`, `src/lib/idb.ts`, `src/app/settings.ts`, `src/app/route.ts`, `src/app/icons.tsx`
- Test: `src/app/route.test.ts` (new), `src/app/settings.test.ts`, `src/lib/idb.test.ts`

**Interfaces (produces):**

```ts
// src/types.ts
export type LinkRel = 'builds-on' | 'extends' | 'baseline' | 'contradicts' | 'same-problem' | 'related'
export const SYMMETRIC_RELS: ReadonlySet<LinkRel>   // contradicts, same-problem, related
export interface PaperLink extends Item { kind: 'link'; to: string; rel: LinkRel; note?: string }
export interface Sidecar {  // added optional fields
  gist?: { text: string; updatedAt: number }
  topics?: { ids: string[]; updatedAt: number }
  pin?: { x: number; y: number; updatedAt: number }
  links?: PaperLink[]
}
export interface LibraryIndex { verdicts?: Record<string, DriveNode> }   // added
export interface Item { … }            // now exported (PaperLink and the host need it)
export interface Thread { session?: string }   // added: the host's SDK session id for agent threads
// src/config.ts
export const VERDICT_SUFFIX = '.worth-reading.md'
export const PAPER_CONTEXT_MAX_CHARS = 600_000
export const HOST_DEFAULT_URL = 'http://127.0.0.1:7700'
export const HOST_PROBE_INTERVAL_MS = 60_000
export const MAP_SIZE = 1000
// src/lib/idb.ts
export type StoreName = 'files' | 'sidecars' | 'notebooks' | 'verdicts' | 'settings' | 'meta' | 'queue'   // DB_VERSION = 4
// src/app/settings.ts (AppSettings additions, defaults)
hostUrl: string            // HOST_DEFAULT_URL
hostToken: string          // ''
gradeOnThisDevice: boolean // true
gradingSince: number       // 0; boot.tsx stamps Date.now() once when it is 0 (papers modified after it are "new")
// src/app/route.ts
export type Route = { kind: 'library'; folderId?: string } | { kind: 'paper'; id: string } | { kind: 'map' } | { kind: 'pair'; token: string }
export const mapHash = '#/map'
// src/app/icons.tsx: new names 'terminal', 'map', 'link', 'pin', 'verdict'
```

- [ ] **Step 1: Write failing tests**

```ts
// src/app/route.test.ts
it('parses the map and pair routes', () => {
  expect(parseRoute('#/map')).toEqual({ kind: 'map' })
  expect(parseRoute('#/pair/abc-123')).toEqual({ kind: 'pair', token: 'abc-123' })
  expect(parseRoute('#/')).toEqual({ kind: 'library' })
})
// src/app/settings.test.ts (add)
it('defaults the host and grading settings', async () => {
  const s = await loadSettings()
  expect(s.hostUrl).toBe('http://127.0.0.1:7700'); expect(s.hostToken).toBe(''); expect(s.gradeOnThisDevice).toBe(true)
})
// src/lib/idb.test.ts (add)
it('has a verdicts store', async () => { await idbSet('verdicts', 'p1', { verdict: 'read' }); expect(await idbGet('verdicts', 'p1')).toEqual({ verdict: 'read' }) })
```

- [ ] **Step 2: Run them to see them fail** — `npx vitest run src/app/route.test.ts src/app/settings.test.ts src/lib/idb.test.ts` → FAIL (unknown route kinds / missing fields / unknown store).
- [ ] **Step 3: Implement** the additions listed in Interfaces. `DB_VERSION` 3 → 4, `STORES` gains `'verdicts'`; `parseRoute` matches `#/map` and `#/pair/<token>` (token = `[^/?#]+`, decoded); `emptySidecar` adds `links: []`; `boot.tsx` saves `gradingSince: Date.now()` after `loadSettings` when it is 0 (test in `boot.test.tsx`: a fresh install gets a stamp, a stored stamp is kept); icons are 24×24 stroke paths in the style of the existing ones.
- [ ] **Step 4: Run the full checks** — `npx tsc -b && npx vitest run && npm run build` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "foundation: v4 types, config, routes, settings and DB v4"`

---

## Part A — Whole paper in the direct Ask

### Task A1: `paperBlock` and the whole-paper request

**Files:**
- Modify: `src/ai/context.ts`, `src/ai/claude.ts` (ContentBlock type), `src/config.ts` (already has the cap)
- Test: `src/ai/context.test.ts`

**Interfaces:**

```ts
// src/ai/claude.ts
export type ContentBlock =
  | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  | { type: 'image'; source: {...} }   // unchanged
// src/ai/context.ts
export interface AskInput { paperTitle: string | null; anchor: Anchor; paper: PageText[]; crop?: Crop; history: ChatMessage[]; question: string }
/** The page-tagged paper text, identical for every thread on the paper; drops trailing pages (never `keepPage`) past PAPER_CONTEXT_MAX_CHARS. */
export function paperBlock(paper: PageText[], title: string | null, keepPage?: number): { text: string; truncated: boolean }
/** The second block: the anchor page's text with the passage marked, or the not-found / area line. */
export function selectionBlock(anchor: Anchor, page: PageText | undefined, hasImage: boolean): string
export function buildRequest(input: AskInput): { system: string; messages: ApiMessage[]; summary: { pages: number; words: number; page: number; hasImage: boolean; truncated: boolean } }
```

Format of `paperBlock` output, exactly (no selection marks inside it):

```
Paper: <title>                                  (line omitted when title is null)
<paper pages="N">
<page n="1">
…page text…
</page>
…
</paper>
<truncated from_page="K"/>                      (only when truncated; pages K..N were dropped)
```

`selectionBlock`: for a text anchor found verbatim, `Page N again, with the selected passage marked between << and >>:\n<page_text page="N">\n…marked text…\n</page_text>`; not found verbatim, `Selected passage on p.N (not found verbatim in the page text): <<…>>`; for an area anchor `The user selected a region on p.N; it is shown in the image below.` (with image) or `The user is asking about a selected area on p.N, which is not marked in the text.` First user turn content: `[paperBlock (cache_control), selectionBlock, image?, question]`.

- [ ] **Step 1: Rewrite `src/ai/context.test.ts`** so every existing case uses `paper: [page('…', 1), page('…', 2), pageText]` and add:

```ts
it('tags every page in a cached first block and marks the selection in a second block', () => {
  const { messages } = buildRequest(input({ paper: [page('Intro.', 1), page('Methods.', 2), pageText] }))
  const first = blocks(messages[0].content)
  expect(first[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } })
  expect(first[0].text).toMatch(/<paper pages="3">\n<page n="1">\nIntro\.\n<\/page>/)
  expect(first[0].text).not.toContain('<<')
  expect(first[1].text).toContain('<<We call our particular attention')
  expect(first[1]).not.toHaveProperty('cache_control')
  expect(first[first.length - 1]).toEqual({ type: 'text', text: 'What is this?' })
})
it('keeps the paper block byte-identical across follow-ups and across threads', () => {
  const a = buildRequest(input()); const b = buildRequest(input({ history: [msg('user', 'q1'), msg('assistant', 'a1')], question: 'q2' }))
  const c = buildRequest(input({ anchor: areaAnchor, crop }))
  expect(blocks(b.messages[0].content)[0]).toEqual(blocks(a.messages[0].content)[0])
  expect(blocks(c.messages[0].content)[0]).toEqual(blocks(a.messages[0].content)[0])
})
it('drops trailing pages past the cap but never the selected page', () => {
  const big = Array.from({ length: 5 }, (_, i) => page('x'.repeat(200_000), i + 1))
  const { text, truncated } = paperBlock(big, null, 5)
  expect(truncated).toBe(true); expect(text).toContain('<page n="5">'); expect(text).not.toContain('<page n="4">'); expect(text).toContain('<truncated from_page="4"/>')
})
it('empty pages stay tagged', () => {
  expect(paperBlock([page('', 1), page('', 2)], 'T').text).toContain('<page n="2">\n\n</page>')
})
it('reports pages and truncation in the summary', () => {
  expect(buildRequest(input()).summary).toMatchObject({ pages: 3, page: 3, hasImage: false, truncated: false })
})
```

- [ ] **Step 2: Run** `npx vitest run src/ai/context.test.ts` → FAIL (no `paperBlock`, `pageText` removed).
- [ ] **Step 3: Implement** `paperBlock`, `selectionBlock` and the new `buildRequest`; update `SYSTEM_PROMPT` to say the whole paper is provided page by page, that references like "Section 5", "Eq. 3", "Fig. 2" must be resolved by reading that part, and to keep the `"quote" (p. N)` citation rule. Truncation: while total length > `PAPER_CONTEXT_MAX_CHARS`, drop the last page that is not `keepPage`.
- [ ] **Step 4: Run** `npx vitest run src/ai/context.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "ask: send the whole page-tagged paper with a cache breakpoint"`

### Task A2: AskPanel and Reader send the whole paper

**Files:**
- Modify: `src/ai/AskPanel.tsx`, `src/app/Reader.tsx` (the `AskPanel` mount near `getPageText={(p) => doc.getPageText(p)}`), `src/pdf/document.ts`
- Test: `src/ai/AskPanel.test.tsx`, `src/pdf/document.test.ts`

**Interfaces:**

```ts
// src/pdf/document.ts (PdfDoc addition)
/** Text of every page in order, loaded once and shared. */
getAllText(): Promise<PageText[]>
// src/ai/AskPanel.tsx
getPaperText(): Promise<PageText[]>     // replaces getPageText
```

- [ ] **Step 1: Tests** — in `AskPanel.test.tsx` replace `getPageText` with `getPaperText: vi.fn(async () => [page1, pageText])` and assert the request body text contains `<paper pages="2">` and the status line reads `Sending the whole paper (2 pages)` (`+ image` for an area anchor). In `document.test.ts` add `it('getAllText returns every page once', …)` against `test/fixtures/attention.pdf` (15 pages, same `getPageText` promise objects reused).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `getAllText` with a memoised promise over `getPageText(1..numPages)`; `sendingLine(s)` → `` `Sending the whole paper (${s.pages} page${s.pages === 1 ? '' : 's'})${s.truncated ? ', trimmed' : ''}${s.hasImage ? ' + image' : ''}` ``; Reader passes `getPaperText={() => doc.getAllText()}`.
- [ ] **Step 4: Full checks** → PASS. **Step 5: Commit** — `git commit -am "ask: panel and reader load every page once"`

---

## Part B — Worth-reading notes

### Task B1: The skill, the plugin manifest, and the bundled skill text

**Files:**
- Create: `skills/worth-reading/SKILL.md`, `.claude-plugin/plugin.json`, `src/verdict/skill.ts`
- Test: `src/verdict/skill.test.ts`

**Interfaces:**

```ts
// src/verdict/skill.ts
export const SKILL_TEXT: string                       // import text from '../../skills/worth-reading/SKILL.md?raw'
/** The instructions after the skill's own front matter. */
export function skillBody(text: string): string
/** First 12 hex characters of SHA-256 of the text. */
export async function skillHash(text: string): Promise<string>
```

`SKILL.md` front matter: `name: worth-reading`, `description: Judge whether a paper is worth the owner's time and write the worth-reading note beside it.` Body (the owner edits this): who the owner is (robotics/ML engineer: bimanual manipulation, VLA policies, imitation learning, real-robot deployment, data pipelines); what to judge (contribution and novelty, evidence quality and baselines, reproducibility, relevance to the owner's work, time cost); the three verdicts and when each applies; the **exact** note format from the spec (front matter keys `verdict, confidence, read_time, one_line, topics, year, venue, authors, skill, model, generated` then sections `## Verdict`, `## What it does`, `## Why it matters (or doesn't) for you`, `## Weak points`, `## Where to look first`); rules: quote page numbers as `p. N`; a **Topics** section listing the vocabulary (`vla`, `imitation-learning`, `diffusion-policy`, `action-chunking`, `bimanual`, `teleoperation`, `data-collection`, `sim2real`, `tactile`, `grasping`, `world-models`, `rl`, `vision`, `language`, `evaluation`, `hardware`) with the rule "one to three tags from this list, primary first; add one new lowercase kebab-case tag only when nothing fits"; if the paper text is empty or garbled, verdict `skim`, confidence `low`, and say the PDF has no text layer; when web tools are available, check the venue and whether a newer version or follow-up exists, else leave `venue` out; leave `skill`, `model`, `generated` as `<filled by the app>` — the runner overwrites them. `.claude-plugin/plugin.json`: `{ "name": "marginalia", "description": "Marginalia skills", "version": "0.1.0" }`.

- [ ] **Step 1: Tests**

```ts
it('strips the front matter and hashes stably', async () => {
  expect(skillBody('---\nname: x\n---\nBody here')).toBe('Body here')
  expect(await skillHash('abc')).toMatch(/^[0-9a-f]{12}$/); expect(await skillHash('abc')).toBe(await skillHash('abc'))
})
it('bundles the real skill', () => { expect(SKILL_TEXT).toContain('name: worth-reading'); expect(skillBody(SKILL_TEXT)).toContain('## Verdict') })
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (hash via `crypto.subtle.digest('SHA-256', …)`). **Step 4: Run** → PASS. **Step 5: Commit** — `git commit -am "verdict: the worth-reading skill and its bundled text"`

### Task B2: Note parse/serialize

**Files:**
- Create: `src/verdict/note.ts`
- Test: `src/verdict/note.test.ts`

**Interfaces:**

```ts
export type VerdictKind = 'read' | 'skim' | 'skip'
export const VERDICT_KINDS: readonly VerdictKind[]
export interface VerdictNote {
  verdict: VerdictKind; confidence: 'high' | 'medium' | 'low'; readTime: string; oneLine: string; topics: string[]
  year?: number; venue?: string; authors?: string
  skill: string; model: string; generated: string   // ISO 8601
  body: string                                      // markdown after the front matter, trimmed
}
/** Parses a note; null when the front matter is missing or `verdict` is not read/skim/skip. */
export function parseNote(markdown: string): VerdictNote | null
export function serializeNote(note: VerdictNote): string
export function isVerdictNote(x: unknown): x is VerdictNote
export function isOutdated(note: VerdictNote, currentSkill: string): boolean
```

Front matter grammar: block between the first `---` line and the next `---` line; `key: value` per line; a value `[a, b, c]` is a list (items trimmed, surrounding quotes stripped); other values are strings with surrounding quotes stripped; `year` parsed as an integer when numeric. Unknown keys ignored; missing optional keys absent. `serializeNote` writes the keys in the order above, lists as `[a, b]`, then a blank line and `body`.

- [ ] **Step 1: Tests** — round trip of a full note; `parseNote` returns null for `verdict: maybe` and for no front matter; quotes stripped; `topics: []` empty list; `isOutdated` true when `skill` differs; `serializeNote(parseNote(x)!)` is stable on a second pass.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** — `git commit -am "verdict: note front matter parse and serialize"`

### Task B3: The verdict companion in Drive sync

**Files:**
- Modify: `src/drive/api.ts`, `src/drive/library.ts`, `src/drive/test-helpers.ts` (FakeDrive already stores raw content; make the multipart handler keep `text/markdown` media as-is)
- Test: `src/drive/api.test.ts`, `src/drive/library.test.ts`

**Interfaces:**

```ts
// src/drive/api.ts
export type FileMime = 'application/json' | 'text/markdown'
export function createFile(name: string, parentId: string, text: string, mime: FileMime, appProperties: Record<string, string>): Promise<DriveNode>
export function updateFile(id: string, text: string, mime: FileMime): Promise<DriveNode>
export function downloadText(id: string): Promise<string>
// createJsonFile / updateJsonFile / downloadJson stay as wrappers
export function findCompanionFile(pdfId, name, parentId, tag: '1' | 'notes' | 'verdict', pdfKey: 'pdf' | 'notesFor' | 'verdictFor')
// src/drive/library.ts
export function verdictNameFor(pdfName: string): string          // strips .pdf, adds VERDICT_SUFFIX
export function loadVerdict(pdfId: string): Promise<VerdictNote | null>
export function saveVerdict(pdfId: string, note: VerdictNote): void   // debounced like saveSidecar
export function refreshVerdict(pdfId: string): Promise<VerdictNote | null>
/** True when Drive already holds a note for the paper (records it in the index). */
export function hasRemoteVerdict(pdfId: string): Promise<boolean>
```

`Companion<T>` gains `mime: FileMime`, `serialize(doc: T): string`, `parse(text: string): unknown` (JSON kinds: `JSON.stringify`/`JSON.parse`; verdict: `serializeNote`/`parseNote` returning `null` → treated as unparseable). `VERDICT: Companion<VerdictNote>` = `{ kind: 'verdict', store: 'verdicts', indexKey: 'verdicts', tag: 'verdict', pdfKey: 'verdictFor', nameFor: verdictNameFor, queueKey: id => 'verdict:' + id, map: i => i.verdicts ?? {}, empty: throws, merge: (a, b) => b.generated > a.generated ? b : a, accepts: isVerdictNote, upgrade: identity, unparseableIsForeign: false, newer: () => false, label: 'verdict' }`. `download()` uses `downloadText` + `c.parse`; `flushOne` uses `createFile`/`updateFile` with `c.mime` and `c.serialize`. `refreshIndex` full-walks once when `index.verdicts` is undefined. `fullWalk`/`setRootFolder` initialise `verdicts: {}`. An unparseable `.worth-reading.md` counts as a failed download in `pullSidecars` (`unparseableIsForeign: false`) and is never overwritten.

- [ ] **Step 1: Tests** (`library.test.ts`, with `FakeDrive`): a `.worth-reading.md` tagged `marginalia=verdict, verdictFor=<id>` beside a PDF is attached on sync and `loadVerdict` returns the parsed note; an untagged file named `<paper>.worth-reading.md` in the same folder attaches by name; `saveVerdict` then `flushQueue` creates the file with `mimeType: 'text/markdown'`, the tags, and content starting with `---\nverdict:`; two notes merge to the newer `generated`; "an unparseable note is kept and reported" (content `garbage` → `syncState` error mentions `verdict`, no upload replaces it); `hasRemoteVerdict` finds a note the index has not seen. (`api.test.ts`): `createFile` sends `Content-Type: text/markdown` for the media part.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Full checks** → PASS. **Step 5: Commit** — `git commit -am "drive: verdict notes as a text companion kind"`

### Task B4: Paper input and the direct grader

**Files:**
- Create: `src/verdict/runner.ts`
- Test: `src/verdict/runner.test.ts`

**Interfaces:**

```ts
export interface PaperInput { pdfId: string; name: string; title: string | null; pages: PageText[]; bytes: ArrayBuffer }
/** Downloads or reads the cached PDF and extracts every page's text. */
export async function paperInput(pdfId: string): Promise<PaperInput>
export interface DirectOptions { apiKey: string; model: string; skillText: string; signal?: AbortSignal; now?: () => Date }
/** Runs the skill through the Messages API; the returned note's skill/model/generated are set by this function. */
export async function gradeDirect(paper: PaperInput, opts: DirectOptions): Promise<VerdictNote>
export class VerdictFormatError extends Error {}   // the model's answer did not parse
```

`gradeDirect`: `system = skillBody(skillText) + '\n\nThe paper follows in the user message as page-tagged text. Write the note now, exactly in the specified format, nothing before the front matter.'`; `messages = [{ role: 'user', content: [{ type: 'text', text: paperBlock(pages, title).text, cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'Write the worth-reading note for this paper.' }] }]`; stream with `streamMessage`; `parseNote` on the collected text (tolerate text before the first `---`); throw `VerdictFormatError` on null; overwrite `skill` (await `skillHash(skillText)`), `model`, `generated` (`now().toISOString()`).

- [ ] **Step 1: Tests** — with `fetch` mocked to an SSE answer (reuse the `sseAnswer`/`okResponse` helpers pattern from `AskPanel.test.tsx`): the request body's first user block is the paper block with `cache_control`; a well-formed answer parses and `skill/model/generated` are overwritten; prose before the front matter is tolerated; an answer without front matter throws `VerdictFormatError`; "a paper with no text is graded with the skill's 'no text' rule" (pages empty → the user block still contains `<paper pages="2">` and the system prompt contains the skill body). `paperInput` test: with `getPdfBlob` mocked to the fixture bytes, returns 15 pages and the title.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (open with `openPdf`, `getAllText`, `destroy`). **Step 4: Run** → PASS. **Step 5: Commit** — `git commit -am "verdict: direct grader over the Messages API"`

### Task B5: The grading queue

**Files:**
- Create: `src/verdict/grader.ts`
- Modify: `src/app/App.tsx` (start the grader beside `startAutoSync`)
- Test: `src/verdict/grader.test.ts`

**Interfaces:**

```ts
export type Grader = (paper: PaperInput) => Promise<VerdictNote>
export interface GraderDeps { host(): Grader | null; direct(): Grader | null; paper(pdfId: string): Promise<PaperInput> }
export const grading = signal<string | null>(null)                  // pdfId being graded
export const gradeErrors = signal<Record<string, string>>({})       // this session's failures
/** Watches the library and settings; grades ungraded papers one at a time, newest first; returns a stop function. */
export function startGrader(deps?: GraderDeps): () => void
/** Grades one paper now, replacing any note. */
export function gradeNow(pdfId: string, deps?: GraderDeps): Promise<VerdictNote>
/** The hash notes are compared against: the paired host's when ready, else the bundled skill's. */
export function currentSkillHash(): Promise<string>
/** Every paper without a note, regardless of date (the back catalogue). */
export function ungradedPapers(): Promise<string[]>
/** Grades the back catalogue one at a time; resolves with the count graded. */
export function gradeUngraded(deps?: GraderDeps): Promise<number>
/** Papers whose note's skill hash differs from the current one. */
export function outdatedPapers(currentSkill: string): Promise<string[]>
export function regradeOutdated(deps?: GraderDeps): Promise<number>
```

Default deps: `host` = `hostState.value.status === 'ready' ? hostGrader : null` (Task D4; until then `() => null`), `direct` = key set ? `gradeDirect` with `settings.visionModel` : null, `paper = paperInput`. A pass runs when `library` or `sidecarRevision` changes and after `syncLibrary` resolves; candidates = `Object.values(index.papers)` with `Date.parse(modifiedTime) > settings.gradingSince`, no `index.verdicts[id]`, no local record (`loadVerdict` null), not in `gradeErrors`, not already graded this session; sorted by `modifiedTime` desc; the pass takes one, calls `hasRemoteVerdict` (skip when true), grades with host else direct (a host failure falls back to direct in the same pass and is not recorded as the paper's error), `saveVerdict`, then schedules the next pass. `gradeOnThisDevice` false → no automatic passes (`gradeNow`/`gradeUngraded` still work).

- [ ] **Step 1: Tests** — with fake deps and `FakeIndexedDb`/`library` signal set up as in `Library.test.tsx`: two new papers are graded newest first, one at a time (the fake grader resolves on demand); a paper older than `gradingSince` is left alone by the pass but counted by `ungradedPapers`; a graded paper is skipped; a failure is recorded in `gradeErrors` and not retried in the pass; the host grader is preferred when it returns non-null; "host failure falls back to direct"; the device toggle off grades nothing; `gradeUngraded` grades the back catalogue and returns the count; `outdatedPapers` lists only notes with another hash; `regradeOutdated` grades them and returns the count; `currentSkillHash` returns the host's hash when `hostState` is ready.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Full checks** → PASS. **Step 5: Commit** — `git commit -am "verdict: grade new papers one at a time, newest first"`

### Task B6: Verdict UI — library chip, sidebar tab, settings

**Files:**
- Create: `src/verdict/VerdictChip.tsx`, `src/verdict/VerdictTab.tsx`, `src/verdict/verdict.css`
- Modify: `src/library/Library.tsx` (row), `src/app/Sidebar.tsx` (tab `'verdict'`, label "Verdict"), `src/app/Reader.tsx` (pass `pdfId` to the sidebar; `SidebarTab` union), `src/app/Settings.tsx` (Claude section), `README.md` ("Worth reading" section under Using it)
- Test: `src/library/Library.test.tsx`, `src/verdict/VerdictTab.test.tsx`, `src/app/Settings.test.tsx`

**Interfaces:**

```ts
export function VerdictChip({ note, grading }: { note: VerdictNote | null; grading: boolean })   // "Read" | "Skim" | "Skip" | spinner | nothing
export function VerdictTab({ pdfId, onGo }: { pdfId: string; onGo(page: number): void })          // loads via loadVerdict, re-reads on sidecarRevision
```

Tab content: `VerdictChip`, the note `body` through `renderMarkdown` (citations `(p. N)` jump via `onGo`), the line `<model> · skill <hash> · <date>`, **Regenerate** (calls `gradeNow`; disabled while `grading`), and "Written with an older version of the skill" when `isOutdated(note, await currentSkillHash())`. Empty state: "No note yet" plus **Grade now** when a runner is available, else "Add a Claude key or pair the agent host in Settings". Settings → Claude: toggle "Grade new papers on this device"; a line "Skill <hash> · N ungraded · M from an older skill" with **Grade N ungraded** (runs `gradeUngraded`, toasts the count) and **Regenerate M outdated** (runs `regradeOutdated`); both buttons disabled while `grading` or when no runner is available. Chip classes `mg-verdict mg-verdict-read|skim|skip`.

- [ ] **Step 1: Tests** — Library row shows "Read" for a local note; the tab renders the body and the Regenerate button, shows the outdated line when the hash differs; Settings shows the toggle, the ungraded count button and the outdated count button.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Full checks** → PASS. **Step 5: Commit** — `git commit -am "verdict: library chip, sidebar tab and settings"`

---

## Part C — Brain map

### Task C1: Sidecar fields, merge, and pure edits

**Files:**
- Create: `src/map/data.ts`
- Modify: `src/drive/merge.ts`, `src/annot/store.ts` (`setGist`), `src/export/markdown.ts` (gist line under the title when present)
- Test: `src/drive/merge.test.ts`, `src/map/data.test.ts`, `src/annot/store.test.ts`

**Interfaces:**

```ts
// src/map/data.ts (pure; t = updatedAt stamp)
export function withGist(s: Sidecar, text: string, t: number): Sidecar
export function withTopics(s: Sidecar, ids: string[], t: number): Sidecar
export function withPin(s: Sidecar, pin: { x: number; y: number } | null, t: number): Sidecar   // null tombstones by setting pin undefined… see note
export function withLink(s: Sidecar, link: PaperLink): Sidecar          // upsert by id
export function withoutLink(s: Sidecar, id: string, t: number): Sidecar // tombstone
/** Loads, edits and saves a sidecar that may not be open in a store. */
export async function updateSidecar(pdfId: string, edit: (s: Sidecar) => Sidecar): Promise<Sidecar>
// src/annot/store.ts
setGist(text: string): void
```

Note on `pin: null`: store `pin: { x: NaN… }` is not allowed; use `{ x: -1, y: -1, updatedAt: t }` as "unpinned" so the newer tombstone wins a merge; the layout treats negative pins as absent. `mergeSidecars`: `links` via `mergeItems`; `gist`, `topics`, `pin` → the one with the greater `updatedAt` (absent loses). `lastTouched` includes these stamps.

- [ ] **Step 1: Tests** — merge keeps the newer gist/topics/pin and unions links with tombstones; `withLink` upserts; `withoutLink` tombstones with the stamp; `updateSidecar` persists through `saveSidecar` (mock `loadSidecar`/`saveSidecar`); `store.setGist` updates `sidecar.gist` with a fresh stamp and persists.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Full checks** → PASS. **Step 5: Commit** — `git commit -am "map: gist, topics, pin and links on the sidecar"`

### Task C2: The graph model

**Files:**
- Create: `src/map/model.ts`
- Test: `src/map/model.test.ts`

**Interfaces:**

```ts
export interface MapNode { pdfId: string; title: string; year?: number; status: ReadStatus; verdict?: VerdictKind; oneLine?: string; gist: string; topics: string[]; pin?: { x: number; y: number } }
export interface MapEdge { id: string; from: string; to: string; rel: LinkRel; note?: string }
export interface MapGraph { nodes: MapNode[]; edges: MapEdge[]; topics: string[] }   // topics in chain order
/** Builds the graph from the library index, every sidecar and every verdict; edges to missing papers are dropped. */
export async function loadGraph(): Promise<MapGraph>
/** Greedy chain: start with the pair of topics sharing the most edges, append the topic with most edges to either end; ties by id. */
export function topicOrder(nodes: MapNode[], edges: MapEdge[]): string[]
/** The paper a link is stored on and its direction: directed rels keep a→b; symmetric rels go on the smaller id. */
export function canonicalLink(a: string, b: string, rel: LinkRel): { from: string; to: string }
export function shortTitle(title: string): string   // first four words
```

Node `title` = paper name without `.pdf`; `topics` = sidecar `topics.ids` if set else the verdict's `topics`; `verdict`/`oneLine`/`year` from the note.

- [ ] **Step 1: Tests** — "edges to missing papers are dropped from the graph"; topics fall back to the verdict's; `topicOrder` on a 4-topic fixture returns the chain; `canonicalLink` puts `related` on the smaller id and keeps `builds-on` as given.
- [ ] **Step 2–5** as usual. Commit — `git commit -am "map: graph model from sidecars and verdicts"`

### Task C3: The layout

**Files:**
- Create: `src/map/layout.ts`
- Test: `src/map/layout.test.ts`

**Interfaces:**

```ts
export type Positions = Record<string, { x: number; y: number }>
export function hash32(s: string): number
export function mulberry32(seed: number): () => number
/** Topics that are some paper's primary topic, in `graph.topics` order. */
export function anchoredTopics(graph: MapGraph): string[]
export function anchors(topics: string[], size?: number): Record<string, { x: number; y: number }>   // circle radius 0.36·size, first topic at the top
export interface LayoutOptions { warm?: Positions; iterations?: number; size?: number }
/** Deterministic topic-anchored Fruchterman–Reingold; pinned nodes stay put. */
export function layout(graph: MapGraph, opts?: LayoutOptions): Positions
```

Constants from the spec: `k = 0.9·sqrt(size²/n)`; repulsion within `2k`; edge weights builds-on/extends 1.0, baseline 0.8, same-problem/contradicts 0.6, related 0.4; topic gravity 0.08 towards the target (primary anchor, or the 2:1 mean of the paper's *anchored* topics; a paper with no anchored topic has no target), centre gravity 0.01; 200 iterations, temperature from `size/10` to `k/8` linearly by iteration 120 then constant; warm start uses 40 iterations at `k/8`; clamp to `[10, size − 10]`; nodes iterated in sorted id order; start position `target + polar(rng()·0.5·k·sqrt(n_topic), rng()·2π)` (the centre for a paper with no target) from `mulberry32(hash32(pdfId))`; coincident nodes jittered from the node's own rng.

- [ ] **Step 1: Tests** — same input twice → identical output; adding one node moves no other node's start (compare iteration 0 by passing `iterations: 0`); a pinned node ends exactly at its pin; every node within bounds; two topics' members separate (mean distance between clusters > within clusters) on a 20-node fixture; a secondary-only tag adds no anchor (`anchoredTopics`); an untagged paper ends within `size/4` of the centre; a warm start with 40 iterations changes positions by less than 5 % of `size` on average.
- [ ] **Step 2–5.** Commit — `git commit -am "map: deterministic topic-anchored force layout"`

### Task C4: The map screen

**Files:**
- Create: `src/map/viewport.ts`, `src/map/MapView.tsx`, `src/map/Card.tsx`, `src/map/LinkSheet.tsx`, `src/map/map.css`
- Modify: `src/app/App.tsx` (`Screen`: `r.kind === 'map'` → `<MapView />`), `src/library/Library.tsx` (Map button in `SyncHeader`, icon `map`, href `mapHash`)
- Test: `src/map/viewport.test.ts`, `src/map/MapView.test.tsx`

**Interfaces:**

```ts
// viewport.ts
export interface Viewport { x: number; y: number; k: number }          // translate + scale
export function zoomAt(v: Viewport, factor: number, px: number, py: number): Viewport
export function panBy(v: Viewport, dx: number, dy: number): Viewport
export function fitTo(points: { x: number; y: number }[], width: number, height: number, pad?: number): Viewport
export function toMap(v: Viewport, px: number, py: number): { x: number; y: number }
// MapView.tsx
export function MapView()           // loads the graph, lays it out (cached in idb 'meta' key 'mapLayout' as { hash, positions }), renders, owns selection/filter/search/link mode
// Card.tsx
export function Card(props: { node: MapNode; graph: MapGraph; onGist(text): void; onTopics(ids): void; onLink(): void; onUnpin(): void; onNeighbours(): void; onEditLink(id, note): void; onRemoveLink(id): void; onClose(): void })
// LinkSheet.tsx
export function LinkSheet(props: { a: MapNode; b: MapNode; onSave(rel: LinkRel, note: string, from: string, to: string): void; onCancel(): void })
```

Rendering per the spec: hull circles with topic labels, links styled per relation (arrowheads via `<marker>`), nodes (radius `6 + 2·sqrt(degree)`, fill `hsl(hash32(topic) % 360, 55%, 55%)`, status ring, year lightness), labels at `k ≥ 0.8` plus selected/hubs. Interactions per the spec: pan/zoom (pointer events, wheel, two-pointer pinch, double-tap hull → `fitTo` its members), tap node → `Card`, press-and-hold 300 ms then drag (touch) or drag (mouse) → `withPin`, link mode → `LinkSheet` → `updateSidecar(canonical.from, withLink…)`, filter chips (topics, status) and search dim to 15 % opacity, Neighbours (two hops) dims the rest and fits, keyboard arrows/Enter/L/Esc. Edits call `updateSidecar` and reload the graph with a warm-started layout. Phone (<700 px): the card is a bottom sheet.

- [ ] **Step 1: Tests** — `viewport`: `zoomAt` keeps the point under the cursor fixed, `fitTo` contains all points; `MapView` (library + sidecars seeded in `FakeIndexedDb`, layout mocked to a grid): renders one circle per paper, tapping one opens the card with its title, typing a gist and blurring calls `saveSidecar` with `gist.text`, Link mode then tapping another node then saving `builds-on` stores the link on the first paper, saving `related` stores it on the smaller id, a filter chip dims non-matching nodes (opacity attribute) without changing their `cx`.
- [ ] **Step 2–5.** Commit — `git commit -am "map: the brain map screen"`

### Task C5: Gist in the reader

**Files:**
- Modify: `src/verdict/VerdictTab.tsx` (a "Your gist" field at the top using `store.setGist`), `src/app/Sidebar.tsx` (pass `store`), `README.md` ("Map" section)
- Test: `src/verdict/VerdictTab.test.tsx`

- [ ] **Step 1: Test** — typing in the gist field and blurring calls `store.setGist('…')`. **Step 2–5.** Commit — `git commit -am "map: gist field in the reader sidebar"`

---

## Part D — Host and terminal

### Task D1: Host package scaffold and protocol

**Files:**
- Create: `host/package.json`, `host/tsconfig.json`, `host/vite.config.ts`, `host/README.md`, `host/src/protocol.ts`, `host/src/main.ts` (placeholder that prints the version)
- Modify: root `package.json` (scripts), `.gitignore` (`host/node_modules`, `host/dist`), `vitest.config.ts` (`include` adds `host/src/**/*.test.ts`)

**Interfaces:**

```ts
// host/src/protocol.ts (no Node or DOM types)
export const HOST_VERSION = '0.1.0'
export type HostEvent =
  | { type: 'turn_start' }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; id: string; ok: boolean; summary: string }
  | { type: 'status'; text: string }
  | { type: 'turn_end'; costUsd: number; durationMs: number; numTurns: number }
  | { type: 'note'; markdown: string }
  | { type: 'error'; message: string }
export interface StatusResponse { version: string; model: string; skill: string; auth: 'api-key' | 'oauth-token' | 'none'; cwd: string }
export interface PaperUpload { name: string; title: string | null; pages: { n: number; text: string }[]; pdf: string }   // pdf = base64
export interface MessageBody { text: string; quote?: { text: string; page: number }; image?: string }
```

Scripts (root): `"host:install": "npm --prefix host install"`, `"host:check": "tsc -p host/tsconfig.json"`, `"host:build": "npm run host:check && vite build --config host/vite.config.ts"`, `"host": "npm run host:build && node host/dist/main.js"`. `host/package.json`: `{ "name": "marginalia-host", "private": true, "type": "module", "dependencies": { "@anthropic-ai/claude-agent-sdk": "^0.3.325" } }`. `host/tsconfig.json`: `target es2023`, `module esnext`, `moduleResolution bundler`, `types: ["node"]`, `noEmit`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, strictness flags as the app, `include: ["src"]`. `host/vite.config.ts`: `build: { ssr: 'src/main.ts', outDir: 'dist', emptyOutDir: true, target: 'node22', rollupOptions: { external: [/^@anthropic-ai\//, /^node:/] } }` (rolldown options key as in the root config if Vite 8 requires `rolldownOptions`). Host tests start with `// @vitest-environment node`.

`host/README.md` covers: install (`npm run host:install`), auth (`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, in the environment or `~/.config/marginalia/host.env`), start (`npm run host`), pairing (the printed URL; Chrome asks once for loopback access; Safari cannot reach the host), the token file, the read/write fence, `--allow-bash`, and that the Agent SDK docs reserve claude.ai login for Anthropic's own products so the key path is the supported one.

- [ ] **Step 1:** `npm run host:install` (installs the SDK under `host/node_modules`). **Step 2:** write files; `npm run host:build` → `host/dist/main.js` prints `marginalia-host 0.1.0`. **Step 3:** `npx vitest run` still green. **Step 4: Commit** — `git add -A && git commit -m "host: package scaffold and event protocol"` (never commit `host/node_modules` or `host/dist`).

### Task D2: Event normalisation, fence, papers on disk, HTTP server (SDK-free, fully tested)

**Files:**
- Create: `host/src/events.ts`, `host/src/fence.ts`, `host/src/papers.ts`, `host/src/sse.ts`, `host/src/server.ts`
- Test: `host/src/events.test.ts`, `host/src/fence.test.ts`, `host/src/papers.test.ts`, `host/src/server.test.ts`

**Interfaces:**

```ts
// events.ts — structural SDK message shapes, no SDK import
export interface SdkMsg { type: string; subtype?: string; event?: { type: string; index?: number; delta?: { type: string; text?: string }; content_block?: { type: string; id?: string; name?: string } }; message?: { content: Array<Record<string, unknown>> }; total_cost_usd?: number; duration_ms?: number; num_turns?: number; is_error?: boolean; errors?: string[]; result?: string }
export function createNormalizer(): { push(msg: SdkMsg): HostEvent[]; finalText(): string }
// fence.ts
export function insideDir(file: string, dir: string): boolean
/** Paths under `home` the agent may never read: .ssh .aws .gnupg .kube .docker/config.json .netrc .config/gcloud .config/marginalia .claude .claude.json .marginalia/host-token .marginalia/sessions.json, any `.env` segment, any `.pem`/`.key` file. */
export function isPrivatePath(file: string, home: string): boolean
/** PreToolUse hook: denies Write|Edit|NotebookEdit|Bash outside `paperDir` and Read|Glob|Grep (by `file_path` or `path`) on private paths; {} otherwise. */
export function fenceHook(paperDir: string, home: string): (input: { tool_name: string; tool_input: Record<string, unknown> }) => Promise<Record<string, unknown>>
export const denyAll: (toolName: string) => Promise<{ behavior: 'deny'; message: string }>
// papers.ts
export function paperDir(root: string, pdfId: string): string            // root/papers/<pdfId sanitised to [A-Za-z0-9_-]>
export async function savePaper(root: string, pdfId: string, upload: PaperUpload): Promise<string>   // writes paper.pdf, paper.txt (page-tagged, same format as paperBlock), meta.json; returns the dir
export async function readSessions(root: string): Promise<Record<string, string>>
export async function writeSession(root: string, pdfId: string, sessionId: string | null): Promise<void>
/** The persisted bearer token: read from root/host-token, else generated (32 random bytes, hex) and written with mode 0600. */
export async function loadToken(root: string, rotate?: boolean): Promise<string>
// sse.ts
export function sseStart(res: ServerResponse): void; export function sseSend(res, ev: HostEvent): void; export function sseKeepAlive(res, ms: number): () => void
// server.ts
export interface Session { id: string; events: AsyncIterable<HostEvent>; send(body: MessageBody): void; interrupt(): Promise<void>; close(): void }
export interface Runner { status(): Omit<StatusResponse, 'version'>; openSession(pdfId: string, sessionId: string | null, fresh: boolean): Promise<Session>; verdict(pdfId: string): AsyncIterable<HostEvent>; paperReady(pdfId: string): Promise<boolean> }
export interface ServerOptions { runner: Runner; token: string; origins: string[]; root: string }
export function createServer(opts: ServerOptions): http.Server
```

Normalisation rules: `stream_event` with `content_block_start` of type `tool_use` → `tool_start` (input filled from the completed `assistant` message's matching `tool_use` block, so emit `tool_start` when that block arrives if not already emitted, with the name/id from the start event); `content_block_delta` `text_delta` → `text`; `user` message `tool_result` blocks → `tool_end` with `ok = !is_error` and `summary` = first line of the result text truncated to 80 chars (or `"${n} lines"` when multi-line); `system` subtypes other than `init` → `status` with a short phrase (`compact_boundary` → "Compacting…"); `result` → `turn_end` (or `error` with `errors.join('; ')` when `is_error`). `finalText()` is the concatenated assistant text of the last turn (for verdicts). Routes per the spec; every route checks `Authorization: Bearer <token>` (401) and `Origin` ∈ `origins` (403) and answers `OPTIONS` preflights with `Access-Control-Allow-Origin/Headers/Methods`; bodies capped at 64 MB; unknown routes 404 JSON.

- [ ] **Step 1: Tests** — `events`: a scripted SDK message list (init → stream_event text deltas → assistant with tool_use → user tool_result → stream_event → result) yields the expected `HostEvent[]`; an error result yields `error`. `fence`: `insideDir` rejects `..` and symlink-free prefix tricks (`/a/b` vs `/a/bc`); the hook allows `Write` inside the dir and denies outside with `permissionDecision: 'deny'`; `Read` of `~/Documents/x.md` is allowed; `Read` of `~/.ssh/id_ed25519`, `~/.config/marginalia/host.env`, `~/proj/.env` and `~/x/server.key` are denied; `Grep` with `path: ~/.aws` is denied; `Bash` is denied whatever the input. `papers`: `savePaper` writes the three files and `paper.txt` starts with `<paper pages="2">`; `writeSession(null)` removes the entry; `loadToken` returns the same token twice and a different one with `rotate`. `server` (real `http` on port 0, fake `Runner`): "requests without the bearer or from another origin get 401/403"; `OPTIONS` preflight returns the CORS headers; `GET /status` returns the runner's status plus `version`; `PUT /papers/:id` stores and `paperReady` becomes true; `POST /sessions` + `GET /sessions/:id/events` streams the fake runner's events as `data:` lines with a keep-alive comment; `POST …/messages` reaches `send`; `POST …/interrupt` reaches `interrupt`; `POST /verdicts` + events ends with a `note` event.
- [ ] **Step 2–5.** Commit — `git commit -am "host: event normalisation, write fence, paper store and HTTP server"`

### Task D3: The SDK runner and `main`

**Files:**
- Create: `host/src/agent.ts` (the only `@anthropic-ai/claude-agent-sdk` importer), modify `host/src/main.ts`, `host/README.md`
- Test: `host/src/agent.test.ts` (with `vi.mock('@anthropic-ai/claude-agent-sdk')` providing a fake `query` that yields scripted `SdkMsg`s and records options)

**Interfaces:**

```ts
export interface AgentOptions { root: string; repoDir: string; model: string; effort: 'low' | 'medium' | 'high'; allowBash: boolean; skillHash: string; auth: StatusResponse['auth'] }
export function createRunner(opts: AgentOptions): Runner
```

`openSession(pdfId, sessionId, fresh)`: builds the session's `query({ prompt: inputQueue, options })` with `cwd: paperDir`, `settingSources: []`, `plugins: [{ type: 'local', path: repoDir }]`, `systemPrompt: { type: 'preset', preset: 'claude_code', append: MARGINALIA_APPEND }`, `tools: ['Read','Glob','Grep','WebSearch','WebFetch','Write','Edit','Skill', ...(allowBash ? ['Bash'] : [])]`, `allowedTools: ['Read','Glob','Grep','WebSearch','WebFetch','Skill', ...(allowBash ? ['Bash'] : [])]`, `hooks: { PreToolUse: [{ matcher: 'Read|Glob|Grep|Write|Edit|NotebookEdit|Bash', hooks: [fenceHook(paperDir, home)] }] }`, `canUseTool: (name, input) => name is Write/Edit inside paperDir ? allow with updatedInput: input : denyAll`, `permissionMode: 'default'`, `model`, `effort`, `includePartialMessages: true`, `maxTurns: 40`, `maxBudgetUsd: 2`, `resume: sessionId ?? storedSessionId` unless `fresh`. The input queue is an async generator fed by `send()`; the first message of a new session prepends the page-tagged paper text from `paper.txt`; `quote` becomes a `> "…" (p. N)` line before the text; `image` becomes an image content block. `session_id` from the `init` message is written with `writeSession`. `verdict(pdfId)`: one-shot `query({ prompt: '/marginalia:worth-reading\n\n' + paperText, options })` with the same options minus `Write/Edit`, collects events, ends with `note` from `finalText()` only if `parseNote` (imported from `../../src/verdict/note.ts`) accepts it, else `error`. `MARGINALIA_APPEND` is the text from the spec §3b (the paper was given in the first message; `paper.txt`/`paper.pdf` are there for Grep or a second look; private configuration is off limits). `main.ts`: flags `--port` (7700) `--token` `--new-token` `--app` (`https://purush-foundry.github.io`) `--allow-bash` `--model` `--effort` `--root` (`~/.marginalia`); token from `loadToken(root, newToken)` unless `--token`; loads `~/.config/marginalia/host.env` into `process.env` for missing keys; `auth` = `ANTHROPIC_API_KEY` ? `'api-key'` : `CLAUDE_CODE_OAUTH_TOKEN` ? `'oauth-token'` : `'none'`; `skillHash` from `skills/worth-reading/SKILL.md` read at start (and re-read on `/status`); prints `marginalia-host <v> on http://127.0.0.1:<port>`, `auth: <kind>`, and `Pair: <app>/marginalia/#/pair/<token>` (plus the `http://localhost:5173/#/pair/<token>` line when `--app` is the dev origin); origins = `[app origin, 'http://localhost:5173']`.

- [ ] **Step 1: Tests** — `openSession` passes the options above (assert `cwd`, `plugins[0].path`, `tools`, `allowedTools`, `settingSources: []`, the hook matcher, `resume` equal to the given id, else the stored id on a second open, absent with `fresh`); the first `send` yields a user message containing `<paper pages=`; `verdict` ends with `note` for a valid scripted answer and `error` for an invalid one.
- [ ] **Step 2–5** (`npm run host:check && npx vitest run host`). Commit — `git commit -am "host: Agent SDK sessions, verdict runs and the CLI"`

### Task D4: Browser host client and pairing

**Files:**
- Create: `src/agent/host.ts`, `src/lib/sse.ts` (move `sseEvents` out of `src/ai/claude.ts`, generic over the parsed JSON)
- Modify: `src/ai/claude.ts` (import from `lib/sse`), `src/app/boot.tsx` (pair route → settings + `showToast('Agent host paired')` + `history.replaceState` to `#/`), `src/app/App.tsx` (probe on focus and every `HOST_PROBE_INTERVAL_MS` while paired and permission granted), `src/app/Settings.tsx` ("Agent host" section)
- Test: `src/agent/host.test.ts`, `src/lib/sse.test.ts`, `src/app/boot.test.tsx`, `src/app/Settings.test.tsx`

**Interfaces:**

```ts
export type HostState = { status: 'off' } | { status: 'unreachable' } | { status: 'unauthorised' } | { status: 'ready'; info: StatusResponse }
export const hostState: Signal<HostState>
/** Probes GET /status; `gesture` allows the loopback permission prompt; a 401 sets `unauthorised`. */
export async function probeHost(gesture?: boolean): Promise<HostState>
export function pairHost(token: string, url?: string): Promise<void>
export function forgetHost(): Promise<void>
export async function uploadPaper(paper: PaperInput): Promise<void>
export async function openSession(pdfId: string, sessionId: string | null, fresh: boolean): Promise<string>
export function sessionEvents(sessionId: string, signal: AbortSignal): AsyncGenerator<HostEvent>
export async function sendMessage(sessionId: string, body: MessageBody): Promise<void>
export async function interrupt(sessionId: string): Promise<void>
/** Uploads the paper if needed and runs the skill on the host; the Grader shape from Part B. */
export async function hostGrader(paper: PaperInput): Promise<VerdictNote>
```

All requests: `fetch(url, { mode: 'cors', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, targetAddressSpace: 'loopback' } as RequestInit)`; a 3 s timeout on the probe; `off` when `hostToken` is empty; `probeHost(false)` skips when `navigator.permissions.query({ name: 'loopback-network' })` is not `'granted'` (query failure → attempt anyway). Settings section: status line per state, **Connect** (`probeHost(true)`), **Forget**, the host URL field.

- [ ] **Step 1: Tests** — `sse`: parses `data:` frames and ignores comment lines; `host`: probe sets `ready` with the status body and `unreachable` on a network error, requests carry the bearer and `targetAddressSpace`, `sessionEvents` yields events from a streamed body, `hostGrader` uploads then runs `/verdicts` and returns the `note`; `boot`: `#/pair/tok` stores the token and replaces the hash; Settings renders Connect when paired but unreachable.
- [ ] **Step 2–5.** Commit — `git commit -am "agent: host client, pairing and settings"`

### Task D5: The terminal panel

**Files:**
- Create: `src/agent/transcript.ts`, `src/agent/Terminal.tsx`, `src/agent/terminal.css`
- Test: `src/agent/transcript.test.ts`, `src/agent/Terminal.test.tsx`

**Interfaces:**

```ts
// transcript.ts
export type Line =
  | { kind: 'prompt'; text: string }
  | { kind: 'text'; md: string; done: boolean }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown>; summary?: string; ok?: boolean }
  | { kind: 'status'; text: string }
  | { kind: 'turn'; costUsd: number; durationMs: number }
  | { kind: 'error'; message: string }
export interface Transcript { lines: Line[]; busy: boolean; sessionCostUsd: number }
export function reduce(t: Transcript, ev: HostEvent): Transcript
export function toolLabel(name: string, input: Record<string, unknown>): string   // Read(paper.txt) · Grep(pattern: "x") · WebSearch("q") · WebFetch(url)
export function fromThread(thread: Thread): Transcript    // replays saved turns as prompt + done text lines
// Terminal.tsx
export interface TerminalProps { pdfId: string; title: string; store: AnnotationStore; thread: Thread | null; paper(): Promise<PaperInput>; attach: { text: string; page: number } | null; live: boolean; onCite(page: number, quote: string): void; onClose(): void }
export function Terminal(props: TerminalProps)
```

Behaviour per the spec §3c: on mount, replay `props.thread` with `fromThread`; when `live` (host ready) `uploadPaper` (once per paper per app session) then `openSession(pdfId, thread?.session ?? null, false)` and start `sessionEvents`, storing the returned id on the Thread's `session`; when not `live`, the prompt is replaced by "Pair the agent host on the laptop to continue". The input box handles Enter/Shift-Enter/↑↓ history/Esc; commands `/clear` (`openSession(pdfId, null, true)`, new Thread), `/model <name>` (sends as a message `/model …`; the host passes slash lines through), `/paper`, `/help`; each user line and each finished `text` line are appended to the current `Thread` (`anchor: { page: 0, boxes: [] }`, `model: 'agent'`, `session`) via `store.upsertThread`; assistant text renders through `renderMarkdown(md, onCite)`; tool lines render `⏺ ${toolLabel}` and `⎿  ${summary}` (click toggles the input JSON); the status line shows the spinner word and `esc to interrupt` while busy; the footer shows `turn $x.xx · session $y.yy`. CSS: `.mg-term` dark (`#0f0f0f` background, `#e6e6e6` text, `--mono` 13 px), `⏺` in `#8ad` for tools, `#f66` for errors, `⎿` lines `#888`, the prompt box with a rounded 1 px `#444` border.

- [ ] **Step 1: Tests** — `reduce` on the scripted event list builds the expected lines and cost; `fromThread` replays two turns as prompt/text lines; "a dropped stream ends the turn with an error" (an `error` event sets `busy: false` and appends an error line); `Terminal` with `host.ts` mocked: renders the header with the title, a given thread's turns are shown before any event, `openSession` is called with the thread's `session`, submitting text posts `sendMessage` and shows the `>` prompt line, streamed text appears under `⏺`, a tool_start/tool_end pair renders the label and summary, Esc calls `interrupt`, `/clear` reopens with `fresh: true` and a new Thread, a finished turn upserts the Thread with the two messages and `session`, `live: false` shows the pairing line and no input.
- [ ] **Step 2–5.** Commit — `git commit -am "agent: Claude-Code-style terminal panel"`

### Task D6: Reader wiring and the grader's host path

**Files:**
- Modify: `src/app/Reader.tsx` (state `agent: { thread: Thread | null } | null`, toolbar `onAgent`, mount `<Terminal>` in `.mg-ask-wrap` instead of the Ask panel, `attach` from the current bar selection, `live` from `hostState`), `src/app/Toolbar.tsx` (`onAgent?: () => void` → button with icon `terminal`, rendered only when provided), `src/app/Sidebar.tsx` (ThreadsTab label "Whole paper · agent" for page-0 threads; opening one mounts the Terminal with that thread, live or read-only), `src/app/reader.css` (`.mg-ask-wrap.mg-term-wrap { width: 460px }`), `src/verdict/grader.ts` (default `host` dep = `hostGrader` when `hostState` is ready), `README.md` ("Agent host" section), `docs/testing.md`
- Test: `src/app/Reader.test.tsx`, `src/verdict/grader.test.ts`

- [ ] **Step 1: Tests** — the Agent button appears only when `hostState` is `ready`; clicking it mounts the terminal; opening an agent thread from the sidebar with no host mounts the read-only terminal; the grader's default host dep is `hostGrader` when ready and null otherwise.
- [ ] **Step 2–5.** Commit — `git commit -am "agent: toolbar button, terminal mount and host-first grading"`

---

## Part E — Integration

### Task E1: Merge, docs, backlog

- [ ] Merge the part branches into `purush/v4-agent` (conflicts expected in `types.ts` imports, `App.tsx`, `Settings.tsx`, `Reader.tsx`, `Sidebar.tsx`); run `npx tsc -b && npx vitest run && npm run build && npm run host:check`.
- [ ] `README.md`: sections **Worth reading**, **Map**, **Agent host** (pairing, the Chrome permission, Safari limit, `host.env`, `--allow-bash`), **Development** (`npm run host:install`, `npm run host`); `docs/testing.md`: on-device checks (first Connect prompt, grading from the iPad shows on the laptop, terminal on the laptop, map on the iPad); `docs/backlog.md`: items deferred.
- [ ] Commit — `git commit -am "docs: v4 README, testing and backlog"`
