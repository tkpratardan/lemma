---
name: lemma-eda
description: "EDA kickoff for a fresh dataset: fixed opening scaffold (goal, imports, load, sanity), then chapters derived from the data; scan leakage, land a baseline."
homepage: https://github.com/tkpratardan/lemma
license: MIT
---

# EDA: scaffold first, chapters earned

An EDA notebook is a report someone will read, not a scratchpad. Chapters
come from this data and this question, planned after looking, never
copied from a template.

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

## Derive the chapters after looking, not before

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
