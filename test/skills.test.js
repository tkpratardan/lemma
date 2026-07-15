'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const skillsDir = path.join(root, 'skills');

function readSkill(name) {
  return fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8');
}

test('skill frontmatter contains only the supported keys', () => {
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = readSkill(entry.name);
    const match = source.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(match, `${entry.name} has no YAML frontmatter`);
    const keys = [...match[1].matchAll(/^([a-zA-Z0-9_-]+):/gm)].map((m) => m[1]);
    assert.deepEqual(keys, ['name', 'description'], `${entry.name} has unsupported frontmatter keys`);
  }
});

test('skills are compact judgment checklists with explicit deliverables', () => {
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = readSkill(entry.name);
    const words = source.trim().split(/\s+/).length;
    assert.ok(words >= 100 && words <= 180, `${entry.name} is ${words} words; expected 100–180`);
    assert.match(source, /## Deliver/i, `${entry.name} lacks a deliverable`);
    assert.match(source, /## Check/i, `${entry.name} lacks substantive checks`);
    assert.match(source, /references\/deep-guide\.md/, `${entry.name} lacks progressive disclosure`);
    assert.doesNotMatch(
      source,
      /quick (?:path|task)|full (?:path|task)|canonical trajector|action budget|checkpoint\(|publish_answer|one batched inspection|one computation-and-check cell/i
    );
    assert.ok(
      fs.existsSync(path.join(skillsDir, entry.name, 'references', 'deep-guide.md')),
      `${entry.name} detailed reference is missing`
    );
  }
});

test('deterministic skill helpers are bundled for inventory, profiling, and integrity', () => {
  const helpers = [
    ['lemma-wrangle', 'source_inventory.py'],
    ['lemma-eda', 'profile_table.py'],
    ['lemma-review', 'notebook_integrity.py'],
    ['lemma-review', 'verify_clean_run.py'],
  ];
  for (const [skill, script] of helpers) {
    assert.ok(fs.existsSync(path.join(skillsDir, skill, 'scripts', script)), `${skill}/${script} is missing`);
  }
});

test('wrangling routes on reconciliation risk, not file count', () => {
  const source = readSkill('lemma-wrangle');
  assert.match(source, /Do not enter this skill merely/i);
  assert.doesNotMatch(source, /any question.*more than one file/is);
});

test('descriptive lookups have a minimal exact-answer path', () => {
  const source = readSkill('lemma-describe');
  assert.match(source, /requested number, list, table, or diagnostic/i);
  assert.match(source, /Put the complete result in\s+chat/i);
  assert.match(source, /Do not fit a model/i);
});
