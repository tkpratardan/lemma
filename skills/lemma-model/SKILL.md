---
name: lemma-model
description: >
  Final modeling and rigorous evaluation. Use when the user has completed feature
  engineering and established a strong baseline, and is ready to train complex
  models (e.g., XGBoost, Random Forests, Neural Networks) on the finalized signals.
license: MIT
---

# Final modeling: earning the complexity

A gradient-boosted ensemble that barely beats logistic regression is
complexity that isn't earning its keep. This assumes `lemma-baseline`
already set the split, the noise floor, and the feature set. Load them
exactly as they were, and restate the baseline score at the top of the
notebook. Every model here is measured against that number.

## Add complexity incrementally, not all at once

Start with a standard implementation of a strong algorithm (XGBoost,
LightGBM, Random Forest) rather than jumping straight to the most elaborate
option. Tune on the validation set only, and log hyperparameters and
scores per trial into a table, not print statements.

## Audit the overfitting gap before declaring a winner

A high validation score sitting on a big train-validation gap is a
fragile model, not a good one. If it's overfit, regularize (raise
`min_child_weight`, lower `max_depth`, raise `alpha`/`lambda`) before
accepting the result.

## Justify the complexity against the baseline

Compare the tuned model to the simple reference model from `lemma-baseline`.
If a 1000-tree ensemble beats logistic regression by 0.001 AUC, the
complexity isn't earning its keep. Say so, and let simplicity win the tie.

## Touch the test set once

Only after tuning is done, features are locked, and the architecture is
chosen: evaluate on the hold-out test set, exactly once. A test score well
below validation means validation was overfit. Report that. Don't go back
and tune again.

## Save the artifact

Persist the model and its exact preprocessing with the repo's own
serialization convention (`joblib` if there isn't one), plus a short
manifest: features, split, metric, seed.

## Close: the deployment report

End with an executive summary: the final test metric, the lift over both
the dumb baseline and the simple reference model, the top features
driving predictions (SHAP or permutation importance) tying back to what
EDA found, and any known failure regions. Translate the metric into a
business number only as far as the data supports. Don't invent a dollar
figure.
