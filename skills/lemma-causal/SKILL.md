---
name: lemma-causal
description: Estimate the effect of an intervention for experiments and defensible quasi-experimental or observational designs; do not substitute prediction for identification.
---

# Causal inference

## Deliver

State the design, target population, estimand, effect with uncertainty,
diagnostic evidence, identifying assumptions, and an action-limited
conclusion. If the assignment story is unknown, report association only.

## Check

- Establish treatment, outcome, unit, timing, assignment mechanism, and
  counterfactual comparison.
- Preserve randomized assignment and exclude post-treatment variables from
  adjustment.
- For observational work, state identification assumptions before choosing
  covariates or an estimator.
- Inspect balance, overlap, interference, attrition, compliance, outcome
  measurement, and treatment timing as applicable.
- Challenge the weakest assumption with a pre-trend, placebo, balance, or
  sensitivity check.

Do not call correlation causal, control for mediators or colliders, choose
groups after seeing outcomes, or bury failed overlap or pre-trends.

For design diagnostics and sensitivity methods, read
[references/deep-guide.md](references/deep-guide.md).
