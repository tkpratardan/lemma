#!/usr/bin/env node
// Generate the per-host persona rule files from AGENTS.md.
//
// Each AI agent reads its always-on rules from a different path and format, so
// lemma needs a copy of the persona for each. Hand-maintaining six divergent
// copies is the bug this fixes: they drift the moment AGENTS.md changes (and
// did). Instead, generate them all from the one source — the AGENTS.md body,
// verbatim, with only host-specific frontmatter differing. Same drift-proof
// pattern as scripts/build-openclaw-skills.js. Re-run after any AGENTS.md edit.
//
// This requires AGENTS.md to be host-agnostic: no self-reference ("this file
// is delivered via…") and no per-host plumbing detail, or a verbatim copy
// would state something false in another host's rule file. That delivery
// detail lives in docs/architecture.md, not the persona.
//
// NOT generated here: .cursor/rules/lemma-notebook.mdc — it mirrors notebook
// cell-diff guidance, not the persona, so it has its own source.
//
// Run:  node scripts/build-rule-copies.js

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

for (const [rel, frontmatter] of TARGETS) {
  const p = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, frontmatter + BODY + '\n');
  console.log('wrote', rel);
}
