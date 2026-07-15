---
name: lemma-leakage
description: "Audit a dataset or pipeline for the five leakages that inflate a metric: target, preprocessing, temporal, group, and sampling."
homepage: https://github.com/tkpratardan/lemma
license: MIT
---

# Leakage audit

## Deliver

Rank leakage findings by severity and show reproducible before/after scores,
the contaminated path, the corrected validation design, and remaining risk.

## Check

- Reconstruct information available at the real prediction moment.
- Audit features and missingness for target proxies and post-outcome facts.
- Verify that imputers, encoders, selection, and scaling are fit within each
  training fold.
- Check time travel, repeated entities, near duplicates, source overlap, and
  outcome-dependent sampling.
- Remove suspicious features or strengthen the split and compare with a simple
  baseline.

Do not rationalize an implausible score, rely only on feature importance,
randomly split temporal or repeated-entity data, or continue tuning before
material leakage is resolved.

For the full leakage taxonomy, read
[references/deep-guide.md](references/deep-guide.md).
