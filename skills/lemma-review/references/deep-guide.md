---
name: lemma-review
description: >
  Review a notebook/analysis for anti-patterns before it's trusted or shared.
  Use when the user says "review this notebook", "is my analysis sound",
  "check my work", "sanity-check this model", or before a result drives a
  decision.
---

# Detailed notebook-review guide

# Notebook review

Read the notebook (`vscode_read_notebook` / `jupyterlab_read` /
`read_notebook`) and check it against the failure modes that make
confident-looking analyses wrong. Report findings as a short list, each
with the cell, the risk, and the fix. Don't rewrite unless asked.

## Principles

The checklist below follows from these. For an analysis the checklist
doesn't fit, reason from the principles instead.

- Skepticism scales with surprise. The more striking the finding, the
  more likely "significant" means false positive, so the impressive
  result gets the hardest look. Check leakage first; it is the most
  common way impressive results get manufactured.
- Failures are systematic, so review is a rubric. The same error
  classes recur in every field, and reviewing against named failure
  modes finds what impression-based reading misses. The catalog below
  is that rubric.
- Verify computation before content. A notebook claims that this code
  produced these outputs; out-of-order execution and stale cells break
  the claim silently. What you can't trace cell-to-conclusion you can
  believe but never audit.
- The rubric inverts the other skills' principles: baseline present?
  Split mirrors deployment, decisions made inside it? Choices
  data-contingent? Holdout spent by iteration? Clusters stable,
  distances meaningful? A causal claim hiding in an "association"?
  Reviewing re-runs those arguments against someone else's notebook.

## Correctness: these invalidate results

- Hallucinated success? Confirm execution order and that outputs match
  the visible code (`execution_count`/outputs from `get_state`/`read_notebook`)
  before trusting any reported metric.
- Evaluated on training data? Any metric must come from held-out rows.
- Leakage? Transforms fit before the split, features recorded after the
  prediction moment, random split on temporal/grouped data. Run
  `lemma-leakage` if unsure.
- No baseline? A score with nothing to compare against is meaningless.
- Wrong metric for the problem? Accuracy on imbalanced data, RMSE where
  the cost is asymmetric, a threshold-0.5 default never examined.
- Tuned on the test set? Hyperparameters and model choice come from
  validation, the test set is touched once, at the very end. Repeated
  peeking is slow leakage.
- Large train-validation gap? A strong validation score sitting on a big
  gap to train is overfitting, not skill.

## Soundness: these mislead

- A correlation, coefficient, or p-value reported without a plot behind it.
- `dropna()`/`fillna()` applied with no look at the missingness pattern.
- Conclusions drawn from summary stats over a skewed or multi-modal
  distribution.
- No seed, so results aren't reproducible. One lucky seed: a score that
  swings across seeds/resamples isn't stable, the spread matters as much
  as the point estimate.
- No error analysis? Where does the model fail, which classes, which
  segments, which target deciles? An aggregate score hides a model that's
  excellent in the easy region and useless in the one that matters.
- An outcome that could land unevenly across groups, checked only in
  aggregate? A good overall number can hide harm to a specific subgroup.

## Readability: these hide bugs

- Mega-cells doing load, clean, model, and plot together. Split them, you
  can't debug what you can't isolate.
- No report structure: no goal cell up front, no load-data chapter showing
  the working dataset, no sanity chapter, no chapters with finding
  sentences. Conclusions that can't be traced to the cells supporting them
  can't be audited.
- Stale outputs (cell sources edited after running). Re-run top to bottom.
- Known shortcuts with no `# shortcut:` flag.

## Verdict

End with one line: trustworthy, trustworthy-with-fixes, or not yet, and
the single most important thing to fix first.
