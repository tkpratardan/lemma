---
name: lemma-review
description: "Review a notebook or analysis for data-science anti-patterns before it's trusted or shared."
homepage: https://github.com/tkpratardan/lemma
license: BSD-4-Clause
---

# Notebook review

Read the notebook (`vscode_read_notebook` / `jupyterlab_read` / `read_notebook`)
and check it against the failure modes that make confident-looking analyses
wrong. Report findings as a short list — each with the cell, the risk, and the
fix. Don't rewrite unless asked.

## Correctness (these invalidate results)

- **Hallucinated success?** Confirm execution order and that outputs match the
  visible code (`execution_count`/outputs from `get_state`/`read_notebook`)
  before trusting any reported metric.
- **Evaluated on training data?** Any metric must come from held-out rows.
- **Leakage?** Transforms fit before the split; features recorded after the
  prediction moment; random split on temporal/grouped data. (Run `lemma-leakage`
  if unsure.)
- **No baseline?** A score with nothing to compare against is meaningless.
- **Wrong metric for the problem?** Accuracy on imbalanced data; RMSE where the
  cost is asymmetric; a threshold-0.5 default never examined.
- **Tuned on the test set?** Hyperparameters and model choice come from
  validation; the test set is touched once, at the very end. Repeated peeking
  is slow leakage.
- **Large train–validation gap?** A strong validation score sitting on a big
  gap to train is overfitting, not skill.

## Soundness (these mislead)

- A correlation, coefficient, or p-value reported **without a plot** behind it.
- `dropna()`/`fillna()` applied with no look at the missingness pattern.
- Conclusions drawn from summary stats over a skewed or multi-modal distribution.
- No seed → results aren't reproducible.
- **One lucky seed?** A score that swings across seeds/resamples isn't stable —
  the spread matters as much as the point estimate.
- **No error analysis?** Where does the model fail — which classes, which
  segments, which target deciles? An aggregate score hides a model that's
  excellent in the easy region and useless in the one that matters.
- **Sensitive attribute present (sex, race, age)?** Error and positive rates
  must be checked **per subgroup**, not just in aggregate — a good overall
  number can hide a model that's harmful to a minority group.

## Readability (these hide bugs)

- **Mega-cells** doing load + clean + model + plot — split them; you can't debug
  what you can't isolate.
- **No report structure** — no `#` goal cell up front (question, data,
  decision), no load-data chapter showing the working dataset, no sanity
  chapter, no `##` chapters with finding sentences: when conclusions can't be
  traced to the cells that support them, the notebook can't be audited.
- Stale outputs (cell sources edited after running) — re-run top to bottom.
- Knowing shortcuts with no `# shortcut:` flag.

## Verdict

End with one line: **trustworthy / trustworthy-with-fixes / not yet** — and the
single most important thing to fix first.
