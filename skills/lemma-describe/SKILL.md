---
name: lemma-describe
description: >
  Descriptive/diagnostic analytics ("what happened", "why"): no model, no
  train/test split. Use when the user says "summarize", "what's driving",
  "break it down by", "report the numbers", "cohort", "funnel", "why did X
  change", or wants a metric or segment analysis rather than a prediction.
license: BSD-4-Clause
---

# Descriptive & diagnostic analysis

No model here, so none of the predict-track machinery (baseline model, held-out
split, target leakage) applies. The result is wrong for different reasons: a
miscounted denominator, the wrong grain, or a slice that tells a story the whole
data doesn't. Get those right and the description is trustworthy; miss one and a
confident chart is simply false.

In the notebook, open with the fixed scaffold — `#` goal (the stakeholder's
question, the data used, the decision it informs), `## Imports`, `## Load
data` (ending with a look at the final working dataset), `## Sanity & data
quality` (large or DB-sourced? sample, or push aggregation upstream) — then
one `##` chapter per question the stakeholder actually asked,
`###` subchapters per cut, each closed with a one-sentence finding that names
the grain and the denominator. The rules below apply inside every chapter.

## 1. Fix the unit of analysis and the denominator first

- **Grain:** one row = one *what*? (a user, a session, an order, a user-day.)
  Every count and rate is meaningless until this is pinned. A join that turns
  one order into three rows (fan-out) silently triples every sum.
- **Denominator:** a rate is a fraction — state both halves. "30% churn" of
  *what* population, over *what* window? Most BI errors are a wrong or unstated
  denominator, not a wrong numerator.

## 2. Look at the distribution, never just the headline number

- A mean over a skewed or multimodal column describes no one. Plot it; report
  median + spread when skewed.
- Show the counts behind every rate. A 60%-vs-40% gap on n=12 is noise.

## 3. Beware the slice that invents a story

- **Simpson's paradox:** an aggregate trend can reverse inside every subgroup.
  Before trusting an overall number, check it holds within the obvious splits.
- **Survivorship / selection:** are you describing everyone, or only who's left
  (active users, completed orders)? The filtered population answers a different
  question than the one asked.
- **Garden of forking paths:** slicing until a difference appears is how you
  find noise. Decide the cut you care about before looking, or treat what you
  find as a hypothesis, not a finding.

## 4. Diagnose is not cause

"Why did X change", answered by a correlation or a suggestive segment, is a
*hypothesis*, not a cause — the driver may be a proxy or a confounded third
thing. If the user needs to *act* on the answer, it's a causal question: hand
off to `lemma-causal`.

## Close

State the number, its denominator and grain, the uncertainty (counts behind the
rates), and whether any claim is descriptive or being read as causal. Say what
it means for the decision named in the goal — a number alone isn't a finding.
Quantify in dollars only if the constant is already given; otherwise name
what's missing, don't invent it. One markdown line per finding, next to the
chart.
