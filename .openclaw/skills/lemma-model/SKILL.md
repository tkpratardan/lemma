---
name: lemma-model
description: "Final modeling once the baseline and feature set are locked: tune against validation, audit overfitting, touch the test set once, justify the complexity."
homepage: https://github.com/tkpratardan/lemma
license: MIT
---

# Final modeling

## Deliver

Provide a comparison against the baseline, the selected model and threshold,
stability and subgroup evidence, a locked final evaluation, and operational
limitations.

## Check

- Keep one validation design and decision metric across candidates.
- Compare a small motivated model set; keep preprocessing and tuning within
  training data and set fixed seeds.
- Diagnose train-validation gaps, fold or temporal stability, calibration,
  subgroup behavior, latency, and interpretability.
- Challenge the most fragile feature or assumption with an ablation, shifted
  window, or leakage audit.
- Lock the pipeline and threshold before touching the final test set once.

Do not tune against the test set, change metrics mid-search, compare different
splits, omit the baseline, or hide subgroup regressions behind an aggregate
gain.

For tuning and error-analysis detail, read
[references/deep-guide.md](references/deep-guide.md).
