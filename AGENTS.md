# Working in this repo

- Node lives at `~/.local/node/bin` on the owner's laptop: `export PATH="$HOME/.local/node/bin:$PATH"`.
- Checks that must pass before a commit: `npx tsc -b`, `npx vitest run`, `npm run build`.
- Do not add dependencies. The allowed runtime set is in `package.json`; ask the owner for more.
- Shared types live in `src/types.ts`; extend them only when a module cannot do its job otherwise,
  and say so in your report.
- Every annotation coordinate is normalised to the unrotated page (`Box` in `src/types.ts`).
- Comments: one line, describing what the code does. No dates, history, measured constants, or
  justifications in comments.
- Tests: `src/**/*.test.ts(x)` with vitest (happy-dom). Test behaviour, not mocks. The fixture
  `test/fixtures/attention.pdf` is a 15-page two-column arXiv paper.
- Commit small and often on your own branch; never commit `.env`, keys, or `dist/`.
