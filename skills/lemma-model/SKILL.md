---
name: lemma-model
description: >
  Final modeling and rigorous evaluation. Use when the user has completed feature
  engineering and established a strong baseline, and is ready to train complex
  models (e.g., XGBoost, Random Forests, Neural Networks) on the finalized signals.
license: BSD-4-Clause
---

# Final Modeling — earning the complexity

A gradient-boosted ensemble that barely beats logistic regression is complexity that isn't earning its keep. The final modeling phase is about testing powerful algorithms on a finalized feature set, rigorously preventing overfitting, and delivering a model that will actually generalize in production.

This step assumes you have already run `lemma-baseline` to establish the noise floor, define the honest split, and engineer a robust feature set.

## 1. Respect the split and the baseline

- Load the exactly identical train/validation/test splits established in the baseline phase.
- Load the finalized feature set. 
- Restate the baseline score clearly at the top of the notebook. Every model trained here is measured against that number.

## 2. Train and Tune

Introduce complexity incrementally.
- Start with a standard implementation of a strong algorithm (e.g., XGBoost, LightGBM, Random Forest).
- Tune hyperparameters systematically on the **validation set only**.
- Log hyperparameters and scores per trial into a structured table (a DataFrame), not print statements.

## 3. The Overfitting Audit

Before declaring a winner, audit the gap between train and validation performance:
- A high validation score sitting on a massive train-validation gap is a fragile model waiting to break in production.
- If the model is heavily overfit, aggressively regularize (e.g., increase `min_child_weight`, reduce `max_depth`, increase `alpha`/`lambda`) before accepting the results.

## 4. Justify the complexity

Compare the final tuned complex model to the simple baseline model. 
- Does the lift clear the noise floor established during the baseline phase?
- If a 1000-tree XGBoost model offers a 0.001 improvement in AUC over a logistic regression, the complexity is not justified. Report this finding explicitly. Simplicity wins ties.

## 5. The final test (touch once)

Only when all tuning is complete, features are locked, and the model architecture is chosen: **evaluate on the hold-out test set.**
- This is done exactly once. 
- If the test score is significantly lower than the validation score, the validation set was overfit. Do not go back and tune again. Report the failure.

## 6. Save the artifact

Persist the final model and its exact preprocessing using the repo's existing serialization convention (default `joblib` if none exists), alongside a short manifest — features, split definition, metric, seed.

## Close — the deployment report

End the notebook with a clear, executive summary chapter:
- The final metric on the test set.
- The lift over the dumb baseline and the simple reference model.
- The top 3-5 most important features (shown via SHAP or permutation importance) driving the predictions, validating the signals discovered in EDA.
- Any known limitations or regions where the model performs poorly.
- Translate the headline metric into a business quantity — only as far as the data or user actually supports; no invented dollar figures.
