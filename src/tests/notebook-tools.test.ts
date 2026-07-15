import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanRunSummary } from '../adapters/notebook/tools.js';

test('clean run success omits per-cell output', () => {
  assert.equal(
    cleanRunSummary('ran 12/12 code cells\n--- cell 1 ---\nlarge output'),
    'clean-kernel verification: PASSED — ran 12/12 code cells'
  );
});

test('clean run failure retains bounded diagnostic context', () => {
  const summary = cleanRunSummary('ran 4/12 code cells; stopped at cell 5 (error)\nValueError: bad value');
  assert.match(summary, /^clean-kernel verification: FAILED/);
  assert.match(summary, /ValueError: bad value/);
});
