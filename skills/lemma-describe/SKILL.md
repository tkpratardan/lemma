---
name: lemma-describe
description: Use for complex descriptive decompositions such as cohorts, funnels, segment comparisons, and what-changed investigations. Skip bounded lookups, joins, rankings, counts, averages, and aggregates.
---

# Describe and answer

## When to use

Use this skill when a descriptive question needs a multi-step decomposition or
competing explanations. The root contract covers bounded calculations.

## Deliver

Return the requested number, list, table, or diagnostic with its observation
unit or denominator, population, and time boundary. Put the complete result in
chat and stop when it and its material caveats are supported.

## Check

- Confirm the relevant schema, units, grain, and definitions from the source.
- Check duplicates, missing values, and denominator changes that could alter
  the result.
- For comparisons, align populations and periods. For changes, distinguish
  volume from rate or mix.
- Test one alternative interpretation when wording or semantics are ambiguous.

Use `lemma-wrangle` only when a reconciliation conflict prevents calculation.
Do not fit a model or imply causality from a slice.

For complex decompositions, read
[references/deep-guide.md](references/deep-guide.md).
