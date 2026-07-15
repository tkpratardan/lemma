---
name: lemma-eda
description: >
  Kick off analysis of a fresh dataset with no direction yet. Use when the
  user points at a new dataset or CSV, says "explore", "EDA", "analyze this
  data", "where do I start", or hands you a notebook with data loaded but no
  direction.
---

# Detailed EDA guide

# EDA: scaffold first, chapters earned

An EDA notebook is a report someone will read, not a scratchpad. Chapters
come from this data and this question, planned after looking, never
copied from a template.

## Principles

The procedure below follows from these. When the data doesn't fit the
procedure, reason from the principles instead.

- Exploration generates hypotheses; it can't confirm them. The data
  that suggested a pattern can't also validate it. Promote findings to
  `lemma-inference` or a held-out score before presenting them as
  conclusions.
- Every plot is a model check. Name the expectation before rendering,
  and read a finding as a departure from it. Scanning plots for
  anything interesting manufactures noise discoveries.
- Structure precedes statistics. Pin down what one row is before
  computing anything; a statistic over the wrong grain stays wrong
  however you plot it.
- Re-expression and resistance are part of looking. A log or rank
  transform is a lens. Prefer summaries an outlier can't own, median
  and IQR first, and treat the outlier itself as a candidate finding.
- Usefulness beats precision. A chapter earns its place by changing
  what the reader does next. An approximate answer to the right
  question beats an exact answer to the wrong one.

## Frame before loading anything

Name the question's mode: describe, diagnose, infer, cause, predict, or
discover. If it's actually causal, inferential, descriptive, or
unsupervised, bring that skill's rigor into the relevant chapters instead.
If predicting, ask what decision this informs, what the target is exactly,
and at what grain. Don't guess a target and explore the wrong thing.

## Push the sanity chapter further than usual

Beyond the standard checks: missingness and why, plausible ranges and
units, duplicate rows and ids, and representativeness. Does this sample
match the population the conclusions are about? A filtered or stale
sample makes every later claim about the wrong distribution. Large or
DB-sourced data gets sampled, with a note on where aggregation could move
upstream. Hand off to `lemma-leakage` if anything looks off.

Rename what metadata explains. An uninferrable column (`sensor_12`) gets
the descriptive name from a data dictionary or README if one exists.
Without a source, flag it rather than invent a name.

## When the data isn't a table

Images, text, and audio still get a sanity chapter; it just can't be
`df.describe()`. Look at actual samples, drawn at random and per class,
not the first N files, which share a collection batch. Profile what a
summary can't show: counts and class balance, file sizes, image
resolutions and channels, text lengths, languages and encodings, corrupt
or unreadable files, and near-duplicates (scraped corpora are full of
them, and they become group leakage at split time). The labels are data
too: who annotated them, against what definition, and with what
agreement; a sample of label-vs-content checks belongs in the report.
Metadata (source, timestamp, device, annotator) forms a companion table
that follows every tabular rule in this skill, and it is where the
grouping keys for an honest split live.

Plan the rest as `##` chapters, each named for a signal the data might
hold or a question the framing needs answered. This is judgment, not a
checklist. Chapters that commonly earn their place when the data carries
the signal: the target's distribution (skew, consider the log), feature-target
and feature-feature relationships, temporal columns (trend, seasonality,
drift), geospatial columns (metric by place, location as a proxy for
hidden variables), and entity structure (rows per entity, cohorts,
within- vs across-entity variation).

List the planned chapters in the goal cell as a table of contents, and
keep it honest: update it when a chapter lands, splits, or turns out
empty.

## If predicting, the leakage scan isn't optional

For each candidate feature: could this encode the target, or information
from after the prediction moment? Flag ids, post-outcome fields, and
anything suspiciously correlated with the target. A feature that's "too
good" is leakage until proven otherwise. Invoke `lemma-leakage` if unsure.

## Close: the findings chapter

End with the goal restated, the 2-3 findings that matter, the risks
flagged (leakage, quality, representativeness), and the signals
discovered. Don't start modeling here. Hand off to `lemma-baseline` once
the signals are validated.

## Avoid

- Reaching for models in EDA. It's about finding signals, not fitting them.
- Reflexive `dropna()`/`fillna(0)` with no look at the missingness pattern.
- One mega-cell that loads, cleans, and plots. You can't see where it broke.
- A correlation or p-value without a plot behind it.
- Template theater: the same chapters forced onto every dataset, or a
  table of contents that promises what the notebook never delivers.
