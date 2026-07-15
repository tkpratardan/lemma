import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TaskGateError, TaskStore } from '../mcp/taskState.js';

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'lemma-task-state-'));
  const store = new TaskStore('/workspace/example', base);
  return { base, store };
}

test('the evidence ledger starts without requiring task orchestration metadata', () => {
  const { base, store } = fixture();
  try {
    const begun = store.begin();
    assert.equal(begun.schemaVersion, 6);
    assert.equal(begun.goal, 'Notebook analysis');
    assert.equal(begun.expectedOutput, undefined);
    assert.equal(begun.status, 'active');
    assert.equal(begun.executionCount, 0);
    assert.deepEqual(begun.cells, []);
    assert.deepEqual(begun.observations, []);
    assert.equal('mode' in begun, false);
    assert.equal('stage' in begun, false);
    assert.equal('actionBudget' in begun, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('actions and notebook work can occur in any order without a tool budget', () => {
  const { base, store } = fixture();
  try {
    store.begin({ goal: 'model churn' });
    store.assertCanExecute();
    for (let index = 0; index < 40; index += 1) store.noteAction(`work.${index}`);
    store.markMutation({ executed: true });
    store.recordCell({
      cellId: 3,
      revision: 1,
      status: 'ok',
      surface: 'jupyter',
      executionCount: 2,
      sourceHash: 'abc',
      outputHash: 'def',
      outputSummary: '42',
    });
    store.markInspected({ kind: 'variable', target: 'result' });
    store.record({
      risks: [{ risk: 'customers repeat across rows', mitigation: 'use a group split' }],
    });
    assert.equal(store.requireActive().lastAction, 'work.39');
    assert.equal(store.requireActive().executionCount, 1);
    assert.equal(store.requireActive().cells.length, 1);
    assert.equal(store.requireActive().observations.length, 1);
    assert.equal(store.requireActive().status, 'active');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('an optional audit receipt stores evidence metadata but not answer prose', () => {
  const { base, store } = fixture();
  try {
    store.begin({
      goal: 'count rows',
      expectedOutput: { shape: 'scalar', description: 'one count' },
    });
    store.markMutation({ executed: true });
    const completed = store.finalize({
      result: { shape: 'scalar', value: 12, unit: 'rows' },
      evidence: [{ kind: 'cell', cellId: 0, revision: 1 }],
    });
    assert.equal(completed.status, 'complete');
    assert.equal(completed.finalization?.resultShape, 'scalar');
    assert.equal(completed.finalization?.evidenceCount, 1);
    assert.deepEqual(completed.finalization?.evidence, [
      { kind: 'cell', cellId: 0, revision: 1 },
    ]);
    assert.doesNotMatch(JSON.stringify(completed), /"value":12/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('only the current failed execution blocks a receipt and a later success records recovery', () => {
  const { base, store } = fixture();
  try {
    store.begin({ goal: 'diagnose failure' });
    store.markMutation({ errorId: 'cell-1', error: 'ValueError' });
    assert.doesNotThrow(() => store.assertCanVerify());
    assert.throws(
      () => store.finalize({
        result: { shape: 'narrative', summary: 'Unsupported while the cell is broken.' },
        evidence: [{ kind: 'cell', cellId: 1, revision: 1 }],
      }),
      TaskGateError
    );
    store.markMutation({ errorId: 'cell-2' });
    assert.deepEqual(store.requireActive().unresolvedErrors, []);
    assert.equal(store.requireActive().executionCount, 2);
    assert.doesNotThrow(() => store.finalize({
      result: { shape: 'narrative', summary: 'Recovered result.' },
      evidence: [{ kind: 'cell', cellId: 2, revision: 2 }],
    }));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the persisted ledger is compact and legacy controller state migrates passively', () => {
  const { base, store } = fixture();
  try {
    const ledger = store.begin({
      goal: 'describe revenue',
      expectedOutput: { shape: 'scalar', description: 'revenue total', unit: 'USD' },
      taskId: 'Revenue lookup',
    });
    store.record({
      assumptions: [{ statement: 'Currency is USD.' }],
      artifacts: [{ uri: 'notebook.ipynb', description: 'analysis notebook' }],
      sources: [{ uri: 'orders.csv', fingerprint: 'sha256:abc' }],
    });
    const activePath = join(base, ledger.namespace, 'active.json');
    const persisted = readFileSync(activePath, 'utf8');
    assert.match(persisted, /"schemaVersion": 6/);
    assert.doesNotMatch(persisted, /conversation|kernelVariables|messages/);

    writeFileSync(activePath, JSON.stringify({
      ...JSON.parse(persisted),
      schemaVersion: 3,
      mode: 'full',
      stage: 'complete',
      actionCount: 8,
      executionCount: undefined,
      mutationRevision: 3,
    }));
    const migrated = store.active();
    assert.equal(migrated?.schemaVersion, 6);
    assert.equal(migrated?.status, 'complete');
    assert.equal(migrated?.executionCount, 3);
    assert.equal('mode' in (migrated ?? {}), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
