---
name: lemma-inference
description: "Rigor for statistical inference (is the difference real): hypothesis tests, power, multiple comparisons, effect size over p-value."
homepage: https://github.com/tkpratardan/lemma
license: MIT
---

# Statistical inference

## Deliver

Report the estimand, effect estimate, uncertainty interval, population and
denominator, method and assumptions, practical interpretation, and any power
or multiplicity limitation.

## Check

- Define the estimand, comparison, smallest meaningful effect, and sampling or
  assignment process.
- Preserve pairing, clustering, repeated measures, and temporal dependence.
- Inspect sample sizes, missingness, imbalance, outliers, and distribution
  shape.
- Use robust, clustered, paired, permutation, or bootstrap uncertainty when
  the design requires it.
- Separate planned from exploratory tests and account for multiplicity.
- Stress-test the weakest assumption.

Do not equate significance with importance or causality, treat dependent
observations as independent, or report p-values without effect sizes.

For method selection and power detail, read
[references/deep-guide.md](references/deep-guide.md).
