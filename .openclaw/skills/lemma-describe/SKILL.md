---
name: lemma-describe
description: "Rigor for descriptive and diagnostic analytics (what happened and why): denominators, grain, and confounded slices, not model leakage."
homepage: https://github.com/tkpratardan/lemma
license: MIT
---

# Descriptive & diagnostic analysis

No model here, so none of the predict-track machinery (baseline, held-out
split, target leakage) applies. The result is wrong for different reasons:
a miscounted denominator, the wrong grain, or a slice that tells a story
the whole data doesn't. One chapter per question the stakeholder actually
asked, one subchapter per cut, each closed with a finding that names the
grain and the denominator.

## Fix the unit of analysis and the denominator first

Grain: one row equals one what? A user, a session, an order, a user-day.
Every count and rate is meaningless until this is pinned. A join that
turns one order into three rows silently triples every sum. Denominator: a
rate is a fraction, state both halves. "30% churn" of what population,
over what window? Most BI errors are a wrong or unstated denominator, not
a wrong numerator.

## Look at the distribution, never just the headline number

A mean over a skewed or multimodal column describes no one. Plot it,
report median and spread when skewed. Show the counts behind every rate.
A 60-vs-40 gap on n=12 is noise.

## Beware the slice that invents a story

Simpson's paradox: an aggregate trend can reverse inside every subgroup,
so check it holds within the obvious splits before trusting it. Survivorship
and selection: are you describing everyone, or only who's left (active
users, completed orders)? A filtered population answers a different
question than the one asked. Garden of forking paths: slicing until a
difference appears is how you find noise, decide the cut you care about
before looking, or treat what you find as a hypothesis, not a finding.

## Diagnose is not cause

"Why did X change," answered by a correlation or a suggestive segment, is
a hypothesis, not a cause. The driver may be a proxy or a confounded third
thing. If the user needs to act on the answer, it's a causal question:
hand off to `lemma-causal`.

## Close

State the number, its denominator and grain, the uncertainty (counts
behind the rates), and whether any claim is descriptive or being read as
causal. Say what it means for the decision named in the goal. Quantify in
dollars only if the constant is already given, otherwise name what's
missing, don't invent it.
