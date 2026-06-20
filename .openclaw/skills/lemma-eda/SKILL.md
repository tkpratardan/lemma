---
name: lemma-eda
description: "EDA kickoff for a fresh dataset: fixed opening scaffold (goal, imports, load, sanity), then chapters derived from the data; scan leakage, land a baseline."
homepage: https://github.com/tkpratardan/lemma
license: BSD-4-Clause
---

# EDA — scaffold first, chapters earned

An EDA notebook is a report someone will read, not a scratchpad. Every expert analysis shares the same opening scaffold; everything after it is chapters *derived from this data and this question* — planned after looking, never copied from a template. Do it in the live notebook on whichever surface is reachable, checked in this order: `vscode_*` → `pycharm_*` → `jupyterlab_*` — never a throwaway script.

## 0. Check the repo first

Look in the *current working directory* (not lemma's own files) for `.claude/skills/`, `CLAUDE.md`, or `AGENTS.md`. If the repo has its own notebook conventions — structure, libraries, naming, output format — follow them; this skill is the rigor layered on top, not a replacement for them.

## 1. Frame (before loading anything)

First, **name the question's mode** — describe, diagnose, infer, cause, predict, or discover. If the real question is causal (`lemma-causal`), inferential (`lemma-inference`), descriptive/diagnostic (`lemma-describe`), or unsupervised (`lemma-unsupervised`), bring that skill's rigor into the relevant chapters.

If predicting, ask in one sentence: **what decision does this inform, what is the target exactly, and at what grain?** If the user hasn't said, ask — don't guess a target and explore the wrong thing.

## 2. The fixed scaffold — every notebook opens the same way

- `# <Goal>` — the one H1, first cell: what question this notebook answers, which data it uses (source, vintage, grain), and what decision it informs. This is the framing from step 1, written down where every reader starts.
- `## Imports` — one cell; seeds set here.
- `## Load data` — load and assemble, ending with a look at the **final working dataset** (`shape`, `dtypes`, `head(10)`) — the table every later chapter analyzes, shown, not described.
- `## Sanity & data quality` — before trusting anything: missingness (why it's missing, including implicit NaNs/dtype drift from joins), plausible ranges and units, impossible values, duplicate rows and ids, and **representativeness** — does this sample match the population the conclusions are about? A filtered, rebalanced, or stale sample makes every later claim about the wrong distribution. Large or DB-sourced? Sample, or note where aggregation could move upstream. Hand off to `lemma-leakage` if it looks off.
- **Rename what metadata explains.** An uninferrable column (`sensor_12`) → the descriptive name from existing metadata (data dictionary, README); no such source, flag it rather than invent one.

## 3. Now derive the chapters — the expert move

Only after seeing the data: plan the rest of the notebook as `##` chapters, each named for a signal the data might hold or a question the framing needs answered. This is judgment, not a checklist. Chapters that *commonly* earn their place, when the data carries the signal:

- the target / key metric and its distribution (skew → consider the log; for categorical, `value_counts(normalize=True)` is also your base rate)
- relationships: features vs target, and correlations among features
- **temporal** — any date column: trend, seasonality, level shifts; drift of features and of feature–target relationships.
- **geospatial** — any location: the metric by place; location as a bundle of hidden variables (school, income, supply).
- entity structure — repeated ids: rows per entity, cohorts, within- vs across-entity variation.

List the planned chapters at the end of the goal cell as a small table of contents, and keep it honest — update it when a chapter lands, splits, or turns out to be empty.

## 4. Chapter mechanics

- A **chapter** is a `##` markdown cell: the name plus one line on what signal it extracts and why the framing cares.
- A **subchapter** is a `###` markdown cell asking **one question**, the cell(s) that answer it, then a one-sentence **finding** in markdown — what you learned, not what the code did. "Prices are log-normal → model log(price)" is a finding; "plotted the histogram" is not.
- Structure lives in markdown cells, never in code comments or "Cell N" labels.
- "Nothing here" is a legitimate finding — write it and close the subchapter.

## 5. If the mode is predict, one chapter is non-negotiable

- **Leakage scan** (the step people skip): for each candidate feature ask — *could this encode the target, or information from after the prediction moment?* Flag ids, post-outcome fields, and anything suspiciously correlated with the target (`corr_with_target.sort_values()`). A feature that's "too good" is leakage until proven otherwise. If unsure, invoke `lemma-leakage`.

## Close — the findings chapter

End the notebook with its final chapter: the goal restated, the 2–3 findings that matter (pulled up from the subchapter finding lines), the risks flagged (leakage, quality, representativeness), and the signals discovered. 

Do not start modeling here. Once the signals are extracted and validated, hand off to `lemma-baseline` for feature engineering and establishing the floor.

## Avoid

- Reaching for models in EDA. EDA is about finding the signals, not fitting them.
- Reflexive `df.dropna()` / `fillna(0)` with no look at the missingness pattern.
- One mega-cell that loads, cleans, and plots — you can't see where it broke.
- A correlation or p-value reported without a plot behind it.
- Template theater: forcing the same chapters onto every dataset, or a table of contents that promises chapters the notebook never delivers.
- Structure in code comments (`# Cell 5: …`) instead of markdown cells.
