---
name: lemma-eda
description: "EDA kickoff for a fresh dataset: fixed opening scaffold (goal, imports, load, sanity), then chapters derived from the data; scan leakage, land a baseline."
homepage: https://github.com/tkpratardan/lemma
license: MIT
---

# Exploratory data analysis

## Deliver

Provide a trustworthy dataset orientation, a short ranked set of findings,
important limitations, and the next analytical question or baseline suggested
by the evidence.

## Check

- Establish observation unit, source identity, coverage, candidate identifiers
  or targets, and a seed for sampled work.
- Inspect shape, types, ranges, duplicates, missingness, time coverage, and
  group rates. `scripts/profile_table.py` is available for a deterministic
  first pass.
- Explore only patterns that could change a decision or next step.
- Investigate suspicious quality, leakage, subgroup, or temporal patterns
  before recommending modeling.
- State a conclusion for each explored branch.

Do not generate an indiscriminate chart catalog, silently drop missing rows,
infer causality, or turn a bounded question into open-ended EDA.

For visualization and chapter patterns, read
[references/deep-guide.md](references/deep-guide.md).
