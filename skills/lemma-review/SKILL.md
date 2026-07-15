---
name: lemma-review
description: Review a notebook or analysis for correctness, reproducibility, leakage, weak validation, unsupported claims, and misleading communication.
---

# Review an analysis

## Deliver

Return findings ranked by severity, with concrete evidence, consequence, and a
specific correction. Distinguish correctness defects from optional
improvements.

## Check

- Reconstruct the requested estimand or prediction target, observation unit,
  population, and time boundary.
- Verify source identity, units, joins, missing-data handling, and preservation
  of raw inputs.
- Check execution order and whether reported values are reproduced by current
  cells.
- Audit splits, preprocessing, metrics, uncertainty, subgroup behavior,
  leakage, and causal language as applicable.
- Confirm that tables and figures use honest denominators, labels, scales, and
  uncertainty.

Do not rewrite the analysis merely for style, accept a clean-looking notebook
as proof, or report only aggregate metrics when a material group failure is
visible.

For detailed review patterns, read
[references/deep-guide.md](references/deep-guide.md).
