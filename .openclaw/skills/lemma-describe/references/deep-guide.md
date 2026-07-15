---
name: lemma-describe
description: >
  Descriptive/diagnostic analytics ("what happened", "why"): no model, no
  train/test split. Use when the user says "summarize", "what's driving",
  "break it down by", "report the numbers", "cohort", "funnel", "why did X
  change", or wants a metric or segment analysis rather than a prediction.
  Also for any one-off factual question about data content, however small:
  "how many rows", "which customers", "what's the average X", "does this
  file contain Y". Keep exact lookups minimal; use the deeper checks below
  only when several cuts or consequential interpretation make them useful.
---

# Detailed descriptive-analysis guide

# Descriptive & diagnostic analysis

No model here, so none of the predict-track machinery (baseline, held-out
split, target leakage) applies. The result is wrong for different reasons:
a miscounted denominator, the wrong grain, or a slice that tells a story
the whole data doesn't. Keep the work proportional to the question.

## Exact lookups

Pin the requested output and grain, inspect the relevant columns, compute the
answer in the notebook, and run the one check most likely to invalidate it.
Then return the complete value, rows, names, or sequence in the requested
  shape. Do not add a plot, broad EDA, segment search, or report scaffold unless
it could materially change the answer. A saved artifact never substitutes for
the requested answer.

## Principles

The procedure below follows from these. When the data doesn't fit the
procedure, reason from the principles instead.

- Identical summaries can hide different realities. Inspect the distribution
  when its shape could change interpretation; visualize it when that is the
  clearest check, not as a ritual behind every lookup.
- Aggregates can say the opposite of every subgroup, and the correct
  level of aggregation is a causal question about the stratifier.
  Check headlines inside the obvious strata, and read a reversal as a
  discovery about mechanism.
- A rate is two claims and the denominator is the fragile one:
  numerator, denominator, window, population, stated every time. Most
  dashboard errors are denominator errors.
- Slicing is hypothesis generation. Cutting by segment until a
  difference appears guarantees differences. A cut decided before
  looking is a finding; a cut found by searching is a hypothesis. Say
  which one each number is.
- For consequential diagnostic work, the deliverable is a decision-shaped story: what
  changed, by how much, for whom, and what evidence supports the next step.

## Fix the unit of analysis and the denominator first

Grain: one row equals one what? A user, a session, an order, a user-day.
Every count and rate is meaningless until this is pinned. A join that
turns one order into three rows silently triples every sum. Denominator: a
rate is a fraction, state both halves. "30% churn" of what population,
over what window? Most BI errors are a wrong or unstated denominator, not
a wrong numerator.

## Look at the distribution, never just the headline number

A mean over a skewed or multimodal column describes no one. Plot it,
report median and spread when skewed. Show the counts behind every rate.
A 60-vs-40 gap on n=12 is noise.

## Beware the slice that invents a story

Simpson's paradox: an aggregate trend can reverse inside every subgroup,
so check it holds within the obvious splits before trusting it. Survivorship
and selection: are you describing everyone, or only who's left (active
users, completed orders)? A filtered population answers a different
question than the one asked. Garden of forking paths: slicing until a
difference appears is how you find noise, decide the cut you care about
before looking, or treat what you find as a hypothesis, not a finding.

## Diagnose is not cause

"Why did X change," answered by a correlation or a suggestive segment, is
a hypothesis, not a cause. The driver may be a proxy or a confounded third
thing. If the user needs to act on the answer, it's a causal question:
hand off to `lemma-causal`.

## Close

Return the exact requested result first. State its denominator and grain when
material, the uncertainty behind rates, and whether any claim is descriptive
or being read as causal. When a decision is at stake, say what the result means
for that decision.
Quantify in dollars only if the constant is already given; otherwise name
what is missing instead of inventing it.
