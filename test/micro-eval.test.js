'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function assistant(...content) {
  return { type: 'assistant', message: { content } };
}

function result(id, content) {
  return { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } };
}

test('transcript micro-eval detects cost amplification and grounded completion', () => {
  const events = [
    assistant({
      type: 'tool_use', id: 'begin', name: 'mcp__lemma__connect',
      input: { begin: { goal: 'count', expected_output: { shape: 'scalar' } } },
    }),
    result('begin', '{"status":"connected"}'),
    assistant({
      type: 'tool_use', id: 'shell', name: 'Bash',
      input: { command: 'python3 -c "import pandas as pd; pd.read_csv(\'data/orders.csv\')"' },
    }),
    result('shell', '12'),
    assistant({
      type: 'tool_use', id: 'run1', name: 'mcp__lemma__run',
      input: { mode: 'append', source: "pd.read_csv('data/orders.csv').shape[0]" },
    }),
    result('run1', '{"status":"ok"}'),
    assistant({
      type: 'tool_use', id: 'run2', name: 'mcp__lemma__run',
      input: { mode: 'append', source: "pd.read_csv('data/orders.csv').shape[0]" },
    }),
    result('run2', '{"status":"ok"}'),
    assistant({
      type: 'tool_use', id: 'publish', name: 'mcp__lemma__publish_answer',
      input: {
        result: { shape: 'scalar', value: 12 },
        evidence: [{ kind: 'cell', cell_id: 1, revision: 2 }],
      },
    }),
    result('publish', '{"status":"recorded","receipt":{"evidenceCount":1}}'),
    { type: 'result', result: 'FINAL ANSWER: 12' },
  ];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lemma-micro-eval-'));
  const episode = path.join(directory, 'repeat-1');
  fs.mkdirSync(episode);
  const transcript = path.join(episode, 'claude.transcript.jsonl');
  fs.writeFileSync(transcript, events.map((event) => JSON.stringify(event)).join('\n'));
  const run = spawnSync(process.env.PYTHON || 'python3', [path.join(root, 'evals', 'micro_eval.py'), transcript], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const metrics = JSON.parse(run.stdout);
  assert.equal(metrics.tool_call_count, 5);
  assert.equal(metrics.lemma_tool_call_count, 4);
  assert.equal(metrics.shell_escape_count, 1);
  assert.equal(metrics.exact_duplicate_computations, 1);
  assert.equal(metrics.cross_surface_source_recomputations, 1);
  assert.equal(metrics.audit_receipt_recorded, true);
  assert.equal('tool_call_budget' in metrics, false);
  assert.equal(metrics.checks.no_shell_escape, false);
  assert.equal(metrics.checks.no_duplicate_computation, false);

  const aggregate = spawnSync(
    process.env.PYTHON || 'python3',
    [path.join(root, 'evals', 'score_transcripts.py'), directory],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(aggregate.status, 0, aggregate.stderr);
  const rows = fs.readFileSync(path.join(directory, 'lemma_micro_evals.jsonl'), 'utf8').trim().split('\n');
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0]).microEval.audit_receipt_recorded, true);
  fs.rmSync(directory, { recursive: true, force: true });
});
