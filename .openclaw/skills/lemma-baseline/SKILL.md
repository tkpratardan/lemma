---
name: lemma-baseline
description: "Establish a dumb baseline and an honest validation harness before any real model, so every later number means something."
homepage: https://github.com/tkpratardan/lemma
license: MIT
---

# Baseline

## Deliver

Provide a reproducible validation design, a no-information or rule baseline,
the simplest credible model, and the precise score later models must beat.

## Check

- Define the outcome, observation unit, prediction moment, intended use, and a
  fixed seed.
- Match the split to deployment: time-ordered for temporal prediction, grouped
  for repeated entities, otherwise a fixed random split.
- Keep preprocessing inside the training pipeline.
- Choose a decision-relevant metric; do not rely on accuracy alone for
  imbalanced outcomes.
- Compare subgroup behavior and variation across folds or seeds when material.

Do not tune complex models, repeatedly inspect a final test set, preprocess
before splitting, or celebrate a score without the dumb baseline.

For feature iteration and metric guidance, read
[references/deep-guide.md](references/deep-guide.md).
