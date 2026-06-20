---
name: lemma-causal
description: >
  Causal questions ("effect of acting on X"): A/B tests, quasi-experiments,
  confounding not leakage. Use when the user says "did X cause Y", "effect
  of", "impact of", "did the change/campaign work", "A/B test", "experiment",
  "treatment vs control", "diff-in-diff", "uplift", or needs an answer they
  intend to act on.
license: BSD-4-Clause
---

# Causal inference & experiments

A predictive model that fits Y well says nothing about what happens if you
*change* X — that needs a comparison to a credible counterfactual. The whole
game is one question: is the control group a fair stand-in for what the treated
group would have done untreated? Everything below protects that.

In the notebook, open with the fixed scaffold — `#` goal (the causal question
and the action it would justify), `## Imports`, `## Load data`, `## Sanity &
data quality` — then chapters that make the argument the claim must survive:
identification strategy → balance and confounding checks → the effect and its
interval → the assumptions that, if wrong, make it a correlation again. An
empty identification chapter means the effect chapter is fiction.

## 1. Name the identification strategy

How is the effect identified? Randomization (A/B test), or a quasi-experimental
design — difference-in-differences, regression discontinuity, instrumental
variable, matching. If you can't name one, you have a correlation, not an
effect: say so plainly. Which library implements it (statsmodels, DoWhy,
EconML, or none) follows the repo's convention — this skill owns the logic,
not the tool.

## 2. The confounding checklist

- **Confounders:** anything causing both treatment and outcome biases the
  estimate. Randomization handles them in expectation; observational work must
  adjust for them explicitly, and you can only adjust for what you measured.
- **Post-treatment / collider bias:** do **not** control for a variable on the
  causal path from treatment to outcome (a mediator), or a common effect of
  both — it opens bias rather than closing it. Adjust for pre-treatment
  variables only.
- **Selection bias:** who ended up in each group, and is that comparable?
  Opt-in treatment is not random.

## 3. For an A/B test specifically

- Fix the metric, the sample size, and the run length **before** launching.
- **Don't peek-and-stop** — the same optional-stopping trap as `lemma-inference`.
- Confirm randomization actually balanced (pre-treatment covariates similar
  across arms).
- Watch **interference / SUTVA:** one user's treatment leaking to another
  (network effects, shared inventory, marketplace supply) breaks the comparison.

## 4. Report the effect, not just its sign

Effect size with a confidence interval, in units that name what acting would
buy. Check the primary metric's move against guardrail metrics (latency,
errors, cost) — a lift that regresses one isn't an unambiguous win. State the
assumptions the causal claim rests on — the ones that, if wrong, make it a
correlation again.

## Close

One line: the estimated effect, its interval, the identification strategy, and
the key assumption it depends on. If the goal was only to *describe* the gap,
not act on it, that's `lemma-describe`.
