---
name: lemma-baseline
description: >
  Establish the floor and iterate on feature engineering. Use when the user has
  finished EDA and wants to start building features, establishing a baseline,
  finding new signals, or iterating before final complex modeling.
license: BSD-4-Clause
---

# Baseline & Feature Engineering — establishing the floor and finding signal

A model without a baseline is a story; a metric from a bad split is a lie. Build the baseline on raw features first, then earn your complexity through rigorous feature engineering. 

In the notebook, open with the fixed scaffold — `#` goal (what's being predicted, and what score changes a decision), `## Imports` (seed + key library versions noted here), `## Load data`. Then execute the sequence below as `##` chapters, each closed with a one-line markdown finding.

## 1. Pick the split that matches deployment

- **Temporal data** (any date/time meaning) → **time-ordered split**: train on the past, validate on the future. A random split here is look-ahead leakage.
- **Grouped data** (multiple rows per user/store/patient) → **group split**: no group appears in both train and validation.
- **Classification** → **stratify** so class ratios match across train and validation.
- **Otherwise** → a random split (or k-fold). Set a seed.

Hold out a **test set you touch once, at the very end.** Tune on validation only.

## 2. Fit transforms on train only

Imputers, scalers, encoders, target stats — `fit` on train, `transform` on validation. Fitting on the full data before splitting leaks the validation distribution into training.

## 3. The dumb baseline (The Floor)

- Regression → predict the **train mean/median**. Metric: MAE or RMSE.
- Classification → predict the **majority class**, and report the **base rate**. Metric: PR-AUC or recall@k for imbalance — never raw accuracy on a skewed set.
- Time series → **last value** or **seasonal naive**.

Score it on validation. This number is the absolute floor.

## 4. The simple reference model

The dumb baseline is the floor; add **one simple, honest** model (linear/logistic regression, or a shallow tree) using *only the raw features* as a second reference point. The distance from dumb-baseline to simple-model tells you how much signal exists before feature engineering begins.

## 5. The Feature Engineering Loop

This is where the real work happens. Do not jump to a final complex model. Instead, iterate on features:
1. Engineer a new feature or set of features based on the signals identified in EDA, using the repo's existing transform mechanism if it has one — reusable, not a one-off `df['col'] = ...`.
2. Add them to the simple reference model.
3. Check the validation score.
4. **The noise floor check:** Does this new feature actually provide lift, or is it noise? Bootstrap the validation metric (resample 30+ times) or read the spread across CV folds. If the lift falls inside that spread, the feature is discarded.

Iterate until you have exhausted the hypotheses generated during EDA and established a strong, signal-rich feature set.

## 6. Report — score, gap, and final signal set

One markdown line: split type, metric, dumb baseline score, and final engineered baseline score.
Then check the gap: Report **train and validation** score, not just validation. A large train–validation gap is overfitting, not skill.

Once the feature set and baseline are rock solid, and only then, hand off to `lemma-model` to explore complex architectures.
