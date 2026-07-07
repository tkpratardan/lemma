---
name: lemma-inference
description: "Rigor for statistical inference (is the difference real): hypothesis tests, power, multiple comparisons, effect size over p-value."
homepage: https://github.com/tkpratardan/lemma
license: MIT
---

# Statistical inference

The question is whether an observed difference is signal or noise. The
failure modes aren't leakage, they're testing too many things, deciding
the test after seeing the data, and confusing "statistically detectable"
with "matters". Order the chapters the way the discipline demands: design
first (hypothesis, test, threshold, n, written before the data is
touched), then the data behind the test, then effect and interval, then
assumptions. A design chapter above the results chapter is your
pre-registration.

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
