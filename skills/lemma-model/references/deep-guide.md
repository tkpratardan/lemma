---
name: lemma-model
description: >
  Final modeling and rigorous evaluation. Use when the user has completed feature
  engineering and established a strong baseline, and is ready to train complex
  models (e.g., XGBoost, Random Forests, Neural Networks) on the finalized signals.
---

# Detailed final-modeling guide

# Final modeling: earning the complexity

A gradient-boosted ensemble that barely beats logistic regression is
complexity that isn't earning its keep. This assumes `lemma-baseline`
already set the split, the noise floor, and the feature set. Load them
exactly as they were, and restate the baseline score at the top of the
notebook. Every model here is measured against that number.

## Principles

The procedure below follows from these. When the data doesn't fit the
procedure, reason from the principles instead.

- Complexity is debt: entanglement, pipeline sprawl, behavior nobody
  can predict from the code. The debt accrues whether or not the extra
  accuracy shows up, so a complex model owes rent in lift the simple
  one provably can't reach. Ties go to the simpler model.
- Every look at the holdout spends it. Once a score drives a choice,
  later scores on the same holdout run high; the analyst becomes the
  overfitting algorithm, one idea at a time. Tune on validation and
  let the test set answer one question, once.
- A held-out score certifies one distribution. Even a faithful re-draw
  of the test set drops accuracy, and deployment drifts further.
  Report the score as a claim about data like the test set, and probe
  where the model fails instead of trusting one aggregate number.
- A ranking without uncertainty is noise. Point scores are random
  variables over splits and seeds. The fold spread from
  `lemma-baseline` still defines the smallest believable win, and a
  tuned ensemble inside that spread has beaten nothing.

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

## Neural nets change the mechanics, not the rules

On tabular data, tuned gradient boosting remains the number to beat
(Grinsztajn et al.); a neural net that can't clear it hasn't earned its
complexity. Early stopping, checkpoint selection, and architecture search
all tune on validation and spend it like any other look. Seed the
framework and log versions, but expect residual GPU nondeterminism:
report the spread over a few seeds, not one run. Equal validation scores
hide unequal models (D'Amour et al.'s underspecification), so probe
failure regions and stress slices before picking a winner among ties.

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
