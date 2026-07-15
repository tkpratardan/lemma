'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const persona = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');

test('always-on persona stays compact and memorable', () => {
  const words = persona.trim().split(/\s+/).length;
  assert.ok(words <= 350, `persona has ${words} words; expected at most 350`);
  assert.match(persona, /smallest defensible answer/i);
  assert.match(persona, /executed evidence/i);
  assert.match(persona, /issue most likely to change the answer/i);
});

test('persona keeps exact output as an exit condition', () => {
  assert.match(persona, /requested list remains a complete\s+list/i);
  assert.match(persona, /saved artifact supports the\s+answer but does not replace it/i);
});

test('persona does not restore the harmful blanket rules', () => {
  assert.doesNotMatch(persona, /more than one source file.*wrangle/is);
  assert.doesNotMatch(persona, /kernel holds the one true state/i);
  assert.doesNotMatch(persona, /full.*default/i);
  assert.doesNotMatch(persona, /quick tasks|action budget|frame.*inspect.*execute/is);
});
