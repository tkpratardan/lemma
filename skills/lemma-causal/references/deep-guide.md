---
name: lemma-causal
description: >
  Causal questions ("effect of acting on X"): A/B tests, quasi-experiments,
  confounding not leakage. Use when the user says "did X cause Y", "effect
  of", "impact of", "did the change/campaign work", "A/B test", "experiment",
  "treatment vs control", "diff-in-diff", "uplift", or needs an answer they
  intend to act on.
---

# Detailed causal-inference guide

# Causal inference & experiments

A predictive model that fits Y well says nothing about what happens if you
change X, that needs a comparison to a credible counterfactual. The whole
game is one question: is the control group a fair stand-in for what the
treated group would have done untreated? Order the chapters so the
argument has to survive them: identification strategy, then balance and
confounding checks, then the effect and its interval, then the assumptions
that would turn it back into a correlation if wrong. An empty
identification chapter means the effect chapter is fiction.

## Principles

The procedure below follows from these. When the data doesn't fit the
procedure, reason from the principles instead.

- Seeing differs from doing. A model fit to observed Y answers what to
  expect given what was observed; what happens if you act requires a
  counterfactual comparison, and no amount of fit supplies one.
- An effect compares two counterfactuals and only one is ever
  observed. Every design is a strategy for a credible stand-in for the
  missing one. Judge a design by asking what plays that role and why
  to believe it.
- Name the trial you wish you'd run: eligibility, treatment
  strategies, time zero, outcome, contrast. Then ask how the data
  emulates each piece. Most observational biases show up as
  divergences from that protocol, and a misaligned time zero alone
  manufactures effects.
- Adjustment can create bias as well as remove it. Conditioning on a
  common effect opens a spurious path; conditioning on a mediator
  erases the effect. Controlling for everything available generates
  bias. Adjust for pre-treatment variables only, each with a stated
  reason.
- "Associated with", offered to someone deciding whether to act, is a
  causal claim in disguise. The euphemism hides the assumptions
  instead of stating them. Treat the question as causal openly.

## Name the identification strategy

How is the effect identified? Randomization (A/B test), or a
quasi-experimental design: difference-in-differences, regression
discontinuity, instrumental variable, matching. If you can't name one, you
have a correlation, not an effect, say so plainly. Which library
implements it (statsmodels, DoWhy, EconML, or none) follows the repo's
convention. This skill owns the logic, not the tool.

## Check for confounding, not just correlation

Confounders (anything causing both treatment and outcome) bias the
estimate. Randomization handles them in expectation; observational work
must adjust for them explicitly, and only for what was actually measured.
Don't control for a variable on the causal path from treatment to outcome,
or a common effect of both, that opens bias rather than closing it: adjust
for pre-treatment variables only. And check selection: who ended up in
each group, and is that comparable? Opt-in treatment is not random.

## For an A/B test specifically

Fix the metric, sample size, and run length before launching. Don't
peek-and-stop, the same optional-stopping trap as `lemma-inference`.
Confirm randomization actually balanced (pre-treatment covariates similar
across arms). Watch interference: one user's treatment leaking to another
(network effects, shared inventory, marketplace supply) breaks the
comparison.

## Report the effect, not just its sign

Effect size with a confidence interval, in units that name what acting
would buy. Check the primary metric's move against guardrail metrics
(latency, errors, cost), a lift that regresses one isn't an unambiguous
win. State the assumptions the claim rests on, the ones that, if wrong,
make it a correlation again.

## Close

One line: the estimated effect, its interval, the identification strategy,
and the key assumption it depends on. If the goal was only to describe the
gap, not act on it, that's `lemma-describe`.
