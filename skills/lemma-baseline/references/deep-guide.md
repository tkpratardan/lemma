---
name: lemma-baseline
description: >
  Establish the floor and iterate on feature engineering. Use when the user has
  finished EDA and wants to start building features, establishing a baseline,
  finding new signals, or iterating before final complex modeling.
---

# Detailed baseline and feature-engineering guide

# Baseline & feature engineering

A model without a baseline is a story. A metric from a bad split is a lie.
The goal cell states what's predicted and what score would move a
decision. Work through the chapters below, each closed with a one-line
finding.

## Principles

The procedure below follows from these. When the data doesn't fit the
procedure, reason from the principles instead.

- The simplest model finds most of what any model will find, and
  drift, label noise, and cost assumptions swamp the marginal gains of
  sophistication. An unbaselined score is uninterpretable: there is no
  good RMSE, only distance above the floor. Treat a small win over a
  strong simple model as illusory until proven.
- Explaining and predicting are different tasks; a model can do one
  well and the other badly. Decide which is asked before featurizing.
  The reference model's gap over the dumb baseline answers whether the
  data can predict the target at all, and the gap between reference
  and flexible model says whether interactions and nonlinearity exist
  to be found.
- A feature earns its place with new, prediction-time information.
  Univariate correlation proves nothing either way: a correlated
  feature can add nothing beside its neighbors, and useless-alone
  features can matter together. Judge by validation lift in context.
  Any selection that saw all the data biases the score, so choose
  inside the folds or on train only.
- A lift must clear the fold-to-fold spread. Every keep/drop decision
  made by peeking at validation overfits it; the tenth iteration's
  score is optimistic by construction. The once-touched test set
  exists for exactly this.

## Match the split to deployment

The split has to mirror how the model will actually see new data, or the
validation score measures a different problem than production will ask.

- Temporal data → time-ordered split. A random split here is look-ahead leakage.
- Grouped data (multiple rows per user/store/patient) → group split, no group
  in both train and validation.
- Classification → stratify so class ratios match across splits.
- Otherwise → random split or k-fold, seeded.

Hold out a test set you touch once, at the end. Tune on validation only.

## Fit transforms on train only

Imputers, scalers, encoders, target stats: fit on train, transform validation.
Fitting on the full data first leaks the validation distribution into training.

## Set the floor before building anything

The dumb baseline is the number every later model has to beat.

- Regression → predict the train mean/median. Score MAE or RMSE.
- Classification → predict the majority class, report the base rate. Score
  PR-AUC or recall@k, never raw accuracy on a skewed set.
- Time series → last value or seasonal naive.
- Text/image → majority class still floors it; the honest reference is a
  linear probe on pretrained embeddings, not a fine-tuned network.

Score it on validation. Then add one honest reference model (linear/logistic,
or a shallow tree) on the features as they already exist, no engineering yet.
This tells you how much signal the raw data already carries before spending
any effort building more.

## Feature engineering is a cost, not a default

A new feature isn't free: it adds pipeline complexity and a new place for
leakage to hide. Only build one that tests a specific hypothesis EDA
raised, not because more features are cheap to add. Iterate: engineer the
feature using the repo's own transform mechanism if it has one, not a
one-off column, add it to the reference model, and check the lift on
validation. Then ask whether that lift is real, bootstrap the metric or
read the spread across CV folds. A lift inside that spread is noise, and
the feature isn't worth its cost. Keep only what clears the bar, and stop
once the hypotheses from EDA are exhausted.

## Report the score, the gap, and what's left

One line: split type, metric, dumb baseline, final engineered score. Report
both train and validation. A large gap between them is overfitting, not
skill. Once the feature set and baseline hold, hand off to `lemma-model`.
