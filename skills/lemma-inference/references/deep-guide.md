---
name: lemma-inference
description: >
  Statistical inference ("is this difference real, how sure"): evidence, not
  prediction. Use when the user says "is this significant", "p-value",
  "confidence interval", "is the difference real", "hypothesis test", "how
  sure are we", "sample size", or "power".
---

# Detailed statistical-inference guide

# Statistical inference

The question is whether an observed difference is signal or noise. The
failure modes aren't leakage, they're testing too many things, deciding
the test after seeing the data, and confusing "statistically detectable"
with "matters". Order the chapters the way the discipline demands: design
first (hypothesis, test, threshold, n, written before the data is
touched), then the data behind the test, then effect and interval, then
assumptions. A design chapter above the results chapter is your
pre-registration.

## Principles

The procedure below follows from these. When the data doesn't fit the
procedure, reason from the principles instead.

- A p-value measures incompatibility with a model. It says nothing
  about whether the hypothesis is true, how big the effect is, or
  whether it matters. Rest no conclusion on whether p crossed a
  threshold.
- Choices contingent on the data inflate certainty even with a single
  test: if other data would have led to a different test, the p-value
  describes no real procedure. The design chapter exists to fix the
  path before you look.
- In noisy settings, significant estimates exaggerate. Conditional on
  clearing the threshold at small n, the estimate runs high, often
  several-fold, and can carry the wrong sign. Surprising plus
  significant plus small n is the signature of lucky noise.
- Prior odds matter. Where most tested hypotheses are false, most
  significant findings are false too. Calibrate skepticism to how
  surprising the claim is, on top of its p.
- Estimate as well as test. Read the interval as the range of effects
  the data don't rule out. An interval spanning trivial to huge says
  the data can't answer yet; a bare "significant" hides that.

## State the hypothesis and the test before looking

Null and alternative, the test, and the threshold, fixed before you
compute. Picking the test that gives the answer you want is the oldest
way to fool yourself. Check power and sample size too: an underpowered
test that finds "no effect" found nothing, not the absence of an effect.

## Effect size and uncertainty, not just the p-value

Report the estimate and its confidence (or credible) interval, the size
of the thing and how sure you are. A p-value alone hides both. At large n
everything is "significant", a real but trivial effect is still trivial.
State the effect in units someone can act on.

## Multiple comparisons are a silent inflator

Test 20 things at p<0.05 and about one comes up "significant" by chance.
If you ran many tests (many metrics, subgroups, or variants), correct for
it (Bonferroni or FDR) or say plainly that you didn't. Peeking and
stopping when it crosses 0.05 is the same trap: fix n in advance, or use a
method built for sequential looks.

## Check the assumptions the test makes

Independence, distribution, equal variance: the test is only valid if
they hold. A plot of the data behind the test catches most violations
faster than a normality test does. Name which check you used and why.

## Close

State the effect size, its interval, the test and why it fits, n and
power, and any multiplicity correction. If the user wants to know what
caused the difference or what to do about it, that's `lemma-causal`, not
this.
