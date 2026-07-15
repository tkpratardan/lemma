#!/usr/bin/env node
// Generate the per-host persona rule files from AGENTS.md (run after any
// AGENTS.md edit): the body verbatim, only host frontmatter differing, so
// the copies can't drift. Requires AGENTS.md to stay host-agnostic — no
// self-reference or per-host plumbing (that lives in docs/architecture.md).
// .cursor/rules/lemma-notebook.mdc is not generated here; it has its own
// source.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BODY = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8').replace(/\r\n/g, '\n').trim();

const CURSOR_FRONTMATTER =
  '---\n' +
  'description: Lemma senior data-scientist mode for data/notebook work.\n' +
  'globs:\n' +
  'alwaysApply: true\n' +
  '---\n\n';

// [path relative to repo root, frontmatter prepended before the AGENTS.md body]
const TARGETS = [
  ['.agents/rules/lemma.md', ''],
  ['.windsurf/rules/lemma.md', ''],
  ['.github/copilot-instructions.md', ''],
  ['.cursor/rules/lemma-datascience.mdc', CURSOR_FRONTMATTER],
];

const checkOnly = process.argv.includes('--check');
let drifted = false;

for (const [rel, frontmatter] of TARGETS) {
  const p = path.join(ROOT, rel);
  const expected = frontmatter + BODY + '\n';
  if (checkOnly) {
    let actual = null;
    try {
      actual = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    } catch {
      // Missing file = drift.
    }
    if (actual !== expected) {
      console.error(`drifted: ${rel} (run node scripts/build-rule-copies.js)`);
      drifted = true;
    }
    continue;
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, expected);
  console.log('wrote', rel);
}

if (checkOnly) {
  if (drifted) process.exit(1);
  console.log(`All ${TARGETS.length} rule copies match AGENTS.md.`);
}
