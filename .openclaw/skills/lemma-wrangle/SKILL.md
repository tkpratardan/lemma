---
name: lemma-wrangle
description: "Assemble a trustworthy working dataset from messy or multiple sources: grain, keys, joins with match rates, extraction checks, lineage."
homepage: https://github.com/tkpratardan/lemma
license: MIT
---

# Wrangle and reconcile

## Deliver

Produce the requested analytical dataset or result with its output grain,
key/definition contract, join or extraction diagnostics, lineage, and
unresolved conflicts.

## Check

- Inventory source ownership, dates, formats, units, row grain, and likely
  keys. `scripts/source_inventory.py` is available for complex inventories.
- Profile key uniqueness and missingness before joining.
- Preserve raw fields; create documented normalized fields.
- Measure match rates, unmatched records, row multiplication, duplication,
  and metric conservation for joins.
- Validate parsed or transformed values against representative source
  examples.

Do not enter this skill merely because several compatible files are used. Do
not silently coerce units or keys, permit an unexplained many-to-many join, or
drop unmatched records without accounting for them.

For authority matrices and extraction QA, read
[references/deep-guide.md](references/deep-guide.md).
