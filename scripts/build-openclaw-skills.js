#!/usr/bin/env node
// Generate the OpenClaw skill package (.openclaw/skills/) from the canonical
// skills/. OpenClaw skills are SKILL.md (frontmatter + body) — same format
// lemma already uses, with one difference: `description` must be a single
// line under 160 chars. The canonical descriptions are long (tuned for
// Claude's skill picker), so each ships a short one here. The body is copied
// verbatim from skills/<name>/SKILL.md so the ruleset never drifts; only the
// frontmatter is rewritten.
//
// Run:  node scripts/build-openclaw-skills.js

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOMEPAGE = 'https://github.com/tkpratardan/lemma';

const DESCRIPTIONS = {
  // Predict track.
  'lemma-eda': 'EDA kickoff for a fresh dataset: fixed opening scaffold (goal, imports, load, sanity), then chapters derived from the data; scan leakage, land a baseline.',
  'lemma-baseline': 'Establish a dumb baseline and an honest validation harness before any real model, so every later number means something.',
  'lemma-model': 'Final modeling once the baseline and feature set are locked: tune against validation, audit overfitting, touch the test set once, justify the complexity.',
  'lemma-leakage': 'Audit a dataset or pipeline for the five leakages that inflate a metric: target, preprocessing, temporal, group, and sampling.',
  'lemma-review': "Review a notebook or analysis for data-science anti-patterns before it's trusted or shared.",
  // Other-mode tracks (the question isn't always prediction).
  'lemma-describe': 'Rigor for descriptive and diagnostic analytics (what happened and why): denominators, grain, and confounded slices, not model leakage.',
  'lemma-inference': 'Rigor for statistical inference (is the difference real): hypothesis tests, power, multiple comparisons, effect size over p-value.',
  'lemma-causal': 'Rigor for causal questions and A/B tests (the effect of acting on X): confounding, post-treatment bias, valid control groups.',
  'lemma-unsupervised': 'Rigor for clustering, dimensionality reduction, and anomaly detection: validity is stability under resampling, not a held-out score.',
};

const NAMES = Object.keys(DESCRIPTIONS);

function sourceBody(name) {
  const src = fs.readFileSync(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const fm = src.match(/^---\n[\s\S]*?\n---\n?/);
  if (!fm) throw new Error(`skills/${name}/SKILL.md has no frontmatter`);
  return src.slice(fm[0].length);
}

function render(name) {
  const desc = DESCRIPTIONS[name];
  if (desc.length > 160 || desc.includes('\n') || desc.includes('"')) {
    throw new Error(`description for ${name} must be one line, no quotes, under 160 chars`);
  }
  const frontmatter =
    `---\nname: ${name}\ndescription: "${desc}"\nhomepage: ${HOMEPAGE}\nlicense: MIT\n---\n`;
  return frontmatter + sourceBody(name);
}

function outPath(name) {
  return path.join(ROOT, '.openclaw', 'skills', name, 'SKILL.md');
}

module.exports = { DESCRIPTIONS, NAMES, render, outPath, sourceBody };

if (require.main === module) {
  for (const name of NAMES) {
    const p = outPath(name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, render(name));
    console.log('wrote', path.relative(ROOT, p).replace(/\\/g, '/'));
  }
}
