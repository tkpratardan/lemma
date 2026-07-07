---
name: lemma-baseline
description: >
  Establish the floor and iterate on feature engineering. Use when the user has
  finished EDA and wants to start building features, establishing a baseline,
  finding new signals, or iterating before final complex modeling.
license: MIT
---

# Baseline & feature engineering

A model without a baseline is a story. A metric from a bad split is a lie.
The goal cell states what's predicted and what score would move a
decision. Work through the chapters below, each closed with a one-line
finding.

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
