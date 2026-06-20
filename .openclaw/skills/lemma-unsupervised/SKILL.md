---
name: lemma-unsupervised
description: "Rigor for clustering, dimensionality reduction, and anomaly detection: validity is stability under resampling, not a held-out score."
homepage: https://github.com/tkpratardan/lemma
license: BSD-4-Clause
---

# Unsupervised structure

There's no target, so the predict-track tests (held-out accuracy, baseline
model) don't exist. The danger is the opposite: any algorithm will *always*
return clusters, components, or anomalies, whether or not the structure is real.
The job is telling imposed structure from genuine.

In the notebook, open with the fixed scaffold — `#` goal (what structure is
sought and what it would be used for), `## Imports`, `## Load data`, `##
Sanity & data quality` — then chapters: transform decisions → structure
search → stability checks → interpretation. The stability chapter *is* the
results chapter — structure without it is a screenshot, not a finding.

## 1. Scale before you measure distance

Clustering and PCA are distance-based; an unscaled column in large units
dominates the result. Standardize (or justify not doing so) before fitting —
this is the unsupervised analogue of fit-on-train: decide the transform
deliberately, don't let units decide it for you.

## 2. Validity is stability, not a score

- **Resample / reseed:** if the clusters move when you change the seed,
  subsample the rows, or perturb the features, they're an artifact of the run,
  not the data. Real structure survives that.
- **Choose k with a method, not a story:** silhouette, gap statistic, elbow —
  and report which you used. Picking k because the chart looks tidy is the
  unsupervised version of p-hacking.
- **Trivial baseline:** does the structure beat random/shuffled features, or the
  k=1 "everything is one group" null? If not, there may be nothing there.
- **Large n?** Silhouette and other pairwise-distance metrics are O(n²) —
  sample before computing them rather than letting the notebook hang.

## 3. Don't narrate clusters as if discovered

Naming a cluster "high-value churners" turns an unlabeled partition into a
claim. It's a hypothesis to validate, not a finding. And if you score the
clusters against a held-out *label*, you've quietly switched to a supervised
problem — then the leakage rules apply (`lemma-leakage`).

## 4. Mind the dimensionality

In high dimensions distances concentrate and everything looks equidistant, so
clusters and "anomalies" get unreliable. Reduce dimensions deliberately, and be
honest that an anomaly score in high-D is fragile.

## Close

State the structure found, how it held up under resampling, how k (or the
threshold) was chosen, and whether any cluster name is a verified label or a
working hypothesis. Persist the labels/scores back onto the working dataframe
(and save it) — a plot alone isn't a deliverable.
