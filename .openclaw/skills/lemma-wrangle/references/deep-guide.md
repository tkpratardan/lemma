---
name: lemma-wrangle
description: >
  Assemble a trustworthy working dataset when sources genuinely require
  reconciliation. Use for uncertain or conflicting grain, keys, definitions,
  units, authority, extraction, joins, or provenance; values parsed from
  PDFs/logs/documents; or requests such as "clean this up", "combine these",
  "which number is right", and "the sources disagree". Do not trigger merely
  because a straightforward lookup reads more than one compatible file.
---

# Detailed wrangling guide

# Wrangling: assemble the dataset you can defend

Most analysis failures are data failures that happened upstream and
surfaced far from their cause. Wrangling is where the most consequential decisions of the analysis get
made and the least likely place anyone reviews. The deliverable is a
working dataset plus the record of how it was built. These rules are
tool-agnostic: they hold whether the data arrives through files and
pandas, a SQL tool, a retrieval tool, or a document parser.

## Principles

The procedure below follows from these. When the sources don't fit the
procedure, reason from the principles instead.

- Catch data errors at ingestion, against expectations written down
  before looking. A wrong join, unit, or filter multiplies through
  every downstream number and rarely announces itself.
- Every dataset was collected by someone, for some purpose, with some
  filter. Know what a source includes, excludes, and measures (the
  questions a datasheet answers) before trusting any statistic drawn
  from it. Provenance is part of the data.
- One row, one observational unit, one grain per table (Wickham's tidy
  data). Most wrangling bugs are grain bugs: joins across mismatched
  grains, aggregates over hidden duplication, entities counted from
  event rows.
- Linkage is a judgment. Sources rarely share a clean key; matching on
  names, times, or fuzzy ids trades false matches against false
  non-matches (Fellegi-Sunter), and either residue biases the joined
  data. Measure match rates.
- A parsed value is a claim. Anything from a document, log line, OCR
  pass, or extraction tool carries an error rate. Validate a sample
  against the source before the value enters the analysis, and keep
  the pointer back to where it came from.

## Inventory sources before reconciling them

List every source with what it claims to be: system of origin, grain,
time coverage, freshness, known filters. Read the documentation that
ships with the data (README, schema docs, a fee manual) before the data;
domain rules live there, and the question may hinge on them. Where
sources overlap, decide which is authoritative for which fields and write
the decision down.

## Pin the grain and keys of each source

For each table: state what one row is, what identifies it, and whether
that identifier is unique. Check; `id` columns duplicate in the wild.
Count rows, distinct keys, and time boundaries, and reconcile against any
stated totals the documentation provides. A source that contradicts its
own documentation is a finding. Report it, don't patch it silently.

## Join on evidence, reconcile on disagreement

Before a join, confirm both sides' grain and predict the result's row
count. After, check the count and account for the unmatched rows: they
are a population, and dropping them is a sampling decision. Joins into
time-varying data need an as-of condition, not just a matching key
(`lemma-leakage` covers the temporal version). When sources disagree on a
shared field, quantify the disagreement rate before picking a winner; a
0.3% mismatch and a 30% mismatch are different problems.

## Validate extracted values

Spot-check numbers pulled from documents, logs, or parser output against
the raw source: a sample read side by side, units and signs confirmed.
Watch the standard failure modes: missed rows, truncation, encoding,
locale-formatted numbers. If a conclusion rests on a handful of extracted
values, check every one.

## Unstructured corpora are two datasets

A folder of images, documents, or audio is the payload; the metadata and
labels beside it are a table, and the pair must reconcile: every file has
a row, every row a file, one grain between them. Orphans on either side
are losses to count, not noise to skip. Labels carry provenance like any
source: who or what produced them, against what definition, with what
agreement rate. Deduplicate by content (hashes, then near-duplicate
checks), not filename; duplicated payloads become group leakage the
moment the data is split.

Land on one tidy working table per unit of analysis: each variable a
column, each observation a row, at the grain the question needs. Make
every cleaning decision inspectable: what was dropped, imputed, recoded,
deduplicated, and why. Missingness is signal before it is a problem;
understand the mechanism before imputing or dropping (`lemma-eda`'s
sanity rules apply). Keep raw data immutable. Derive, never overwrite.

## Close: the lineage

End with the working dataset saved and a lineage summary a reader can audit:
sources and their authority order, joins with match rates, rows in and out at
each step, cleaning decisions, and open data-quality risks. If the user also
asked a question of the reconciled data, return that complete answer directly;
the dataset and lineage do not substitute for it.

## Avoid

- Wrangling toward the answer. Shaping the data until the expected
  result appears is p-hacking moved upstream.
- Joining first and asking about grain later.
- Silent `dropna()`, dedup, or filters, with no count of what was lost.
- Trusting a column for its name: `revenue` in two systems is two
  definitions until reconciled.
- Treating parser or retrieval output as ground truth because it
  arrived through a tool.
- A final dataset with no record of how it was built.
