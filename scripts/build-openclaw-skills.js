#!/usr/bin/env node
// Generate .openclaw/skills/ from the canonical skills/. The main body and
// progressive-disclosure resources are copied verbatim; only SKILL.md
// frontmatter is rewritten for OpenClaw's single-line description limit.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOMEPAGE = 'https://github.com/tkpratardan/lemma';

const DESCRIPTIONS = {
  // Upstream of every track.
  'lemma-wrangle': 'Assemble a trustworthy working dataset from messy or multiple sources: grain, keys, joins with match rates, extraction checks, lineage.',
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

function resourcePaths(name) {
  const base = path.join(ROOT, 'skills', name);
  const found = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && absolute !== path.join(base, 'SKILL.md')) {
        found.push(path.relative(base, absolute));
      }
    }
  }
  visit(base);
  return found.sort();
}

function sourceResourcePath(name, relative) {
  return path.join(ROOT, 'skills', name, relative);
}

function outResourcePath(name, relative) {
  return path.join(ROOT, '.openclaw', 'skills', name, relative);
}

module.exports = {
  DESCRIPTIONS,
  NAMES,
  render,
  outPath,
  sourceBody,
  resourcePaths,
  sourceResourcePath,
  outResourcePath,
};

if (require.main === module) {
  const checkOnly = process.argv.includes('--check');
  let drifted = false;
  for (const name of NAMES) {
    const outputs = [
      { destination: outPath(name), content: Buffer.from(render(name)) },
      ...resourcePaths(name).map((relative) => ({
        destination: outResourcePath(name, relative),
        content: fs.readFileSync(sourceResourcePath(name, relative)),
      })),
    ];
    for (const { destination, content } of outputs) {
      const rel = path.relative(ROOT, destination).replace(/\\/g, '/');
      if (checkOnly) {
        let actual = null;
        try {
          actual = fs.readFileSync(destination);
        } catch {
          // Missing file = drift.
        }
        if (!actual || !actual.equals(content)) {
          console.error(`drifted: ${rel} (run node scripts/build-openclaw-skills.js)`);
          drifted = true;
        }
        continue;
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content);
      console.log('wrote', rel);
    }
  }
  if (checkOnly) {
    if (drifted) process.exit(1);
    console.log(`All ${NAMES.length} openclaw skills match skills/.`);
  }
}
