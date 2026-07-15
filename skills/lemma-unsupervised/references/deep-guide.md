---
name: lemma-unsupervised
description: >
  Unsupervised work: no labels, validity means stability not a held-out
  score. Use when the user says "cluster", "find groups/segments without
  labels", "anomaly", "outlier detection", "dimensionality reduction", "topic
  model", "embeddings", "t-SNE/UMAP", or "what patterns are in this".
---

# Detailed unsupervised-analysis guide

# Unsupervised structure

There's no target, so the predict-track tests (held-out accuracy, baseline
model) don't exist. The danger is the opposite: any algorithm will always
return clusters, components, or anomalies, whether or not the structure is
real. The job is telling imposed structure from genuine. Order the
chapters: transform decisions, then structure search, then stability
checks, then interpretation. The stability chapter is the results chapter.
Structure without it is a screenshot, not a finding.

## Principles

The procedure below follows from these. When the data doesn't fit the
procedure, reason from the principles instead.

- No correct clustering exists; that is a theorem. Scale-invariance,
  richness, consistency: no algorithm satisfies all three, so every
  algorithm chooses which to give up. k-means finds compact spheres
  because compact spheres are what it looks for.
- Validity is relative to end use. No application-independent quality
  measure exists, so "are these the right segments?" has no answer
  until "right for what?" is written down. Get that from the goal
  cell; no score supplies it.
- Stability is the operational test: structure that survives seeds,
  subsamples, and perturbations reflects the data, and the rest
  reflects the run. Structure can pass this test and still be useless
  for the stated purpose; see the previous principle.
- High dimensions quietly break distance: nearest approaches farthest
  from as few as 10-15 dimensions, and every distance-based method
  inherits that. Check that near and far still differ before trusting
  any of them.
- Algorithms return structure regardless, so seek the null. k-means on
  uniform noise returns k tidy clusters. Comparison against a null
  (shuffled features, random labels, k=1) separates discovered
  structure from imposed.

## Scale before you measure distance

Clustering and PCA are distance-based, an unscaled column in large units
dominates the result. Standardize, or justify not doing so, before
fitting. This is the unsupervised analogue of fit-on-train: decide the
transform deliberately, don't let units decide it for you.

## Validity is stability, not a score

If the clusters move when you change the seed, subsample the rows, or
perturb the features, they're an artifact of the run, not the data. Real
structure survives that. Choose k with a method, not a story: silhouette,
gap statistic, elbow, and report which you used. Picking k because the
chart looks tidy is the unsupervised version of p-hacking. Check whether
the structure beats a trivial baseline, random or shuffled features, or
the k=1 "everything is one group" null. If not, there may be nothing
there. On large n, silhouette and other pairwise-distance metrics are
O(n²), sample before computing them rather than letting the notebook hang.

## Don't narrate clusters as if discovered

Naming a cluster "high-value churners" turns an unlabeled partition into a
claim. It's a hypothesis to validate, not a finding. And if you score the
clusters against a held-out label, you've quietly switched to a supervised
problem, then the leakage rules apply (`lemma-leakage`).

## Mind the dimensionality

In high dimensions distances concentrate and everything looks equidistant,
so clusters and "anomalies" get unreliable. Reduce dimensions
deliberately, and be honest that an anomaly score in high-D is fragile.

## Learned representations obey the same rules

An embedding (word2vec, a sentence encoder, an autoencoder bottleneck, a
foundation-model vector) is a transform, not ground truth. Distance in
that space measures similarity under the embedding's training objective,
which may not be the similarity the question asks about; name which
objective before reading neighbors as meaning. Deep anomaly scores and
neural topic models answer to the same tests as k-means: stability under
seeds and subsamples, and a win over a null, or there is nothing there.

## Projections are for looking, not measuring

t-SNE and UMAP distort by design: cluster sizes, inter-cluster distances,
and much of the global layout are artifacts of the hyperparameters, and
perplexity or `n_neighbors` can manufacture or dissolve structure. Use a
projection to generate hypotheses, and vary its parameters before
trusting any. Cluster in the original or reduced feature space, never on
the 2-D projection's coordinates.

## Close

State the structure found, how it held up under resampling, how k (or the
threshold) was chosen, and whether any cluster name is a verified label or
a working hypothesis. Persist the labels/scores back onto the working
dataframe and save it. A plot alone isn't a deliverable.
