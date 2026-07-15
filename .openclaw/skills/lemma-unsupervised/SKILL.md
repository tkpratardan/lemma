---
name: lemma-unsupervised
description: "Rigor for clustering, dimensionality reduction, and anomaly detection: validity is stability under resampling, not a held-out score."
homepage: https://github.com/tkpratardan/lemma
license: MIT
---

# Unsupervised analysis

## Deliver

Provide the discovered structure or anomalies, the preprocessing and selection
choices that produced them, stability evidence, useful interpretation, and
clear limits on what the pattern means.

## Check

- Define the observation unit, intended use, distance or similarity notion,
  and seed.
- Inspect scaling, missingness, redundancy, outliers, and high-cardinality
  features before fitting.
- Compare against a simple reference and a small motivated set of
  representations or algorithms.
- Test stability across resamples, seeds, perturbations, or time windows.
- Evaluate usefulness with domain checks or downstream outcomes that were not
  used to manufacture the pattern.

Do not treat an attractive projection as validation, select cluster count from
one index alone, or assign causal or essential meaning to algorithmic groups.

For stability and interpretation patterns, read
[references/deep-guide.md](references/deep-guide.md).
