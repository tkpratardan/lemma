---
name: lemma-inference
description: >
  Statistical inference ("is this difference real, how sure"): evidence, not
  prediction. Use when the user says "is this significant", "p-value",
  "confidence interval", "is the difference real", "hypothesis test", "how
  sure are we", "sample size", or "power".
license: BSD-4-Clause
---

# Statistical inference

The question is whether an observed difference is signal or noise. The failure
modes aren't leakage — they're testing too many things, deciding the test after
seeing the data, and confusing "statistically detectable" with "matters".

In the notebook, open with the fixed scaffold — `#` goal (the claim under
test and what decision rides on it), `## Imports`, `## Load data`, `## Sanity
& data quality` — then chapters in the order the discipline demands: design
(hypothesis, test, threshold, n — written *before* the data is touched) → the
data behind the test → effect and interval → assumptions. The design chapter
sitting above the results chapter is your pre-registration.

## 1. State the hypothesis and the test *before* looking

- Null and alternative, the test, and the threshold — fixed before you compute.
  Picking the test that gives the answer you want is the oldest way to fool
  yourself.
- **Power / sample size:** an underpowered test that finds "no effect" found
  nothing, not the absence of an effect. Check whether n could even detect an
  effect the size you'd care about.

## 2. Effect size and uncertainty, not just the p-value

- Report the estimate and its confidence (or credible) interval — the size of
  the thing and how sure you are. A p-value alone hides both.
- **Statistical vs practical significance:** at large n everything is
  "significant"; a real but trivial effect is still trivial. State the effect in
  units someone can act on.

## 3. Multiple comparisons — the silent inflator

- Test 20 things at p<0.05 and ~1 comes up "significant" by chance. If you ran
  many tests (many metrics, subgroups, or variants), correct for it
  (Bonferroni / FDR) or say plainly that you didn't.
- **Optional stopping:** peeking and stopping when it crosses 0.05 inflates the
  false-positive rate. Fix n in advance, or use a method built for sequential
  looks.

## 4. Check the assumptions the test makes

Independence, distribution, equal variance — the test is only valid if they
hold. A plot of the data behind the test catches most violations faster than a
normality test does. Name which check you used (plot, formal test, or a
bootstrap/permutation alternative) and why.

## Close

State the effect size, its interval, the test and why it fits, n / power, and
any multiplicity correction. If the user wants to know *what caused* the
difference or *what to do* about it, that's `lemma-causal`, not this.
