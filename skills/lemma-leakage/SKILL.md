---
name: lemma-leakage
description: >
  Audit for leakage that inflates metrics. Use when a model looks "too good",
  before trusting a strong result, or when the user says "leakage", "this
  score seems too high", "is this legit", "data leak", or "why is my val so
  good".
license: BSD-4-Clause
---

# Leakage audit

If validation looks too good, assume leakage until you've ruled it out.
Leakage is any path by which information reaches the model that it won't have
at prediction time in production — it inflates the metric, and the gap
collapses on deployment. The catalog below maps to the standard reference
(Kapoor & Narayanan's leakage taxonomy, which traced leakage through 294
papers across 17 fields); the one test that subsumes all of it is at the end.
If the audit gets its own notebook, open with the fixed scaffold — `#` goal
(the suspicious result and why it's suspect), `## Imports`, `## Load data`,
`## Sanity & data quality` — then one `##` chapter per family below, each
closed with a one-line verdict — **clean / suspect / leaking** — so the
reader can see what was checked, not just what was found.

## 1. Target leakage — a feature encodes the answer

- Any feature recorded **at or after** the moment you'd predict? A
  `payment_received` flag for predicting default, a `discharge_*` field for
  predicting an admission outcome. Drop it.
- A single predictor with very high correlation (rough rule: > 0.8–0.9) is the
  target in disguise until proven otherwise — an id mapped 1:1, a derived
  column, a downstream artifact. Inspect the top few:
  `df.corr()[target].abs().sort_values(ascending=False).head()`.
- A feature that's a **proxy** for the outcome — recorded separately but
  caused by it — leaks even when it looks innocent.

## 2. Preprocessing fit on all the data — the split must come first

- Scalers, imputers, encoders, target/mean encodings fit on the full dataset
  carry the validation distribution into train. Fit on train, transform
  validation. Put it in a `Pipeline` so the boundary can't be crossed by
  accident.
- **Feature selection** run over the whole dataset (top-k by correlation,
  importance, or a univariate test) is the same leak one level up: the choice
  of columns already saw the validation labels. Select inside CV folds, not
  before them.

## 3. Temporal leakage — the future informs the past

- Random split on time-ordered data → train holds rows from after validation.
  Use a time-based split.
- Rolling/aggregate features that peek ahead (a window centered on `t`, a
  "next-7-days" stat). Windows look **backward only**.
- A join pulling in an entity's *current* state (profile, account status)
  without pinning it to the event's own timestamp leaks the future into the
  past — the join needs an as-of condition, not just a matching key.

## 4. Group / non-independence — the same entity on both sides

- Multiple rows per user/device/patient/session with a random split → the
  model memorizes the entity, not the pattern. Use a group-aware split;
  confirm `set(train_groups) & set(val_groups) == set()`.
- **Duplicates and near-duplicates** are the degenerate case: the exact row
  (or an augmented/resampled copy) in both train and test. De-dup **before**
  splitting, not after.

## 5. Sampling bias — the test set isn't the deployment population

- A metric is only honest about the population the test set is drawn from. If
  validation is filtered, rebalanced, or collected differently from where the
  model will actually run, a great score is measuring the wrong distribution.
- Ask: what population is the claim about, and does the held-out set actually
  represent it?

## Confirm

The one test that subsumes all five: **does this feature or statistic exist,
with this value, at prediction time in production?** If not, it leaks. Remove
it, re-run the baseline, and trust the metric only after the gap to baseline
survives the fix.
