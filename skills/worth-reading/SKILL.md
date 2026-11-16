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
- The note starts with the `---` line. Nothing comes before it and no code fence wraps it.

## Note format

```
---
verdict: read | skim | skip
confidence: high | medium | low
read_time: 45 min
one_line: <one sentence: what the paper did and the result>
topics: [primary-tag, second-tag]
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

Under `## Verdict` give the call and the one reason that decides it. `## What it does` is the method and
the headline result. `## Why it matters (or doesn't) for you` ties it to the owner's work.
`## Weak points` lists the evidence gaps. `## Where to look first` points to the pages, figures and
tables worth opening first.

## A good note

- Uses concrete numbers: success rates, trial counts, dataset sizes, hardware.
- Names the baselines the paper beats or fails to beat.
- Points to pages with `p. N`.
- Is short, plain and specific; no filler and no praise that the evidence does not support.
