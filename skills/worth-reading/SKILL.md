---
name: worth-reading
description: Judge whether a paper is worth the owner's time and write the worth-reading note beside it.
---

You decide whether a paper is worth the owner's time and write a short note saying so. You get the
paper as page-tagged text. Write the whole note from that text alone. If you have web tools, use them
only for the extra checks described below.

## Who the reader is

The owner is a robotics and ML engineer working on bimanual manipulation, VLA policies, imitation
learning, real-robot deployment and data pipelines. Judge the paper by what it is worth to that work,
not by general prestige.

## What to judge

- Contribution and novelty: what is actually new, and is it more than a recombination of known parts.
- Evidence quality and baselines: are the baselines strong and named, are there enough trials, are the
  results real-robot or sim only, are ablations present, are the claims bigger than the evidence.
- Reproducibility: code, data, checkpoints, hardware and hyperparameters the owner could actually use.
- Relevance to the owner's work: would it change what they build, train, collect or deploy.
- Time cost: honest estimate of the time to read the parts that matter, not the whole PDF.

## Verdicts

- `read`: the owner should read it closely; it bears directly on their work or sets a new bar.
- `skim`: worth a quick pass over the key figures and tables; useful context, partial relevance, or
  too little text to judge.
- `skip`: not worth the time; weak evidence, no relevance, or nothing beyond what they already know.

Confidence is `high`, `medium` or `low` and reflects how much of the paper you could verify.

## Topics

Use one to three tags from this list, primary first: `vla`, `imitation-learning`, `diffusion-policy`,
`action-chunking`, `bimanual`, `teleoperation`, `data-collection`, `sim2real`, `tactile`, `grasping`,
`world-models`, `rl`, `vision`, `language`, `evaluation`, `hardware`. Add one new lowercase kebab-case
tag only when nothing fits.

## Rules

- Write every page reference as `p. N`.
- If the paper text is empty or garbled, the verdict is `skim`, the confidence is `low`, and the note
  says the PDF has no text layer. Do not invent content.
- When web tools are available, check the venue and whether a newer version or a follow-up exists.
  Without them, state `venue` only if the paper itself says it; otherwise leave `venue` out.
- Leave `year`, `venue` and `authors` out when unknown.
- Leave `skill`, `model` and `generated` as `<filled by the app>`; the runner overwrites them.
- Output only the note. It starts with the `---` line and ends with the last section: no preamble,
  no code fence, no closing remarks.

## Note format

```
---
verdict: read
confidence: high
read_time: 45 min
one_line: Trains a bimanual diffusion policy from 200 teleoperated demos and beats ACT by 18 points.
topics: [diffusion-policy, bimanual]
year: 2025
venue: CoRL
authors: Smith, Lee, Zhao
skill: <filled by the app>
model: <filled by the app>
generated: <filled by the app>
---
## Verdict
## What it does
## Why it matters (or doesn't) for you
## Weak points
## Where to look first
```

Value rules: `verdict` is one of read, skim, skip. `confidence` is one of high, medium, low. Write one
value only, never the alternatives. `read_time` is an integer and `min`, such as `45 min`. `one_line`
is plain text on a single line with no colon and no leading quote or bracket. `topics` is a bracketed
list. `authors` is a comma-separated string of surnames.

Section shapes:
- `## Verdict`: 2 to 3 sentences with the call and the reason that decides it.
- `## What it does`: one short paragraph on the method and the headline result.
- `## Why it matters (or doesn't) for you`: one short paragraph tied to the owner's work.
- `## Weak points`: 2 to 5 bullets on evidence gaps.
- `## Where to look first`: 3 to 5 bullets, each starting with `p. N`, naming the page, figure or table.

## Checklist

- Starts with `---`; keys in the order shown; unknown optional keys omitted.
- One value per line; topics from the list, primary first.
- All five headings present, in order; nothing after the last section.
- Concrete numbers (success rates, trial counts, dataset sizes) and named baselines.
- Every page reference is written `p. N`.
