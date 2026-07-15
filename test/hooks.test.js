'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('mutating notebook calls do not inject repeated cognitive context', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lemma-hook-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lemma-hook-cwd-'));
  const event = JSON.stringify({
    tool_name: 'mcp__lemma__notebook_add_and_run',
    tool_response: 'executed',
  });
  const result = spawnSync(process.execPath, [path.join(root, 'hooks', 'post-tool-use.js')], {
    cwd,
    env: { ...process.env, HOME: home },
    input: event,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('runtime has no lemma mode controller', () => {
  assert.equal(fs.existsSync(path.join(root, 'hooks', 'lib', 'activation.js')), false);
  const runtimeFiles = [
    'hooks/prompt-submit.js',
    'hooks/session-start.js',
    'hooks/subagent-start.js',
    '.opencode/plugins/lemma.mjs',
  ];
  for (const relative of runtimeFiles) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    assert.doesNotMatch(source, /modeChange|readMode|writeMode|lemma\s+\[on\|off\]|lemma mode off/i);
  }
});

test('mechanical hooks recognize canonical actions and protect raw inputs', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lemma-gate-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lemma-gate-cwd-'));
  const env = { ...process.env, HOME: home };
  fs.mkdirSync(path.join(cwd, 'inputs'));
  fs.writeFileSync(path.join(cwd, 'inputs', 'orders.csv'), 'id,value\n1,2\n');

  const activate = spawnSync(process.execPath, [path.join(root, 'hooks', 'post-tool-use.js')], {
    cwd,
    env,
    input: JSON.stringify({ tool_name: 'mcp__lemma__connect', tool_response: 'connected' }),
    encoding: 'utf8',
  });
  assert.equal(activate.status, 0, activate.stderr);

  const mutation = spawnSync(process.execPath, [path.join(root, 'hooks', 'pre-tool-use.js')], {
    cwd,
    env,
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'inputs/orders.csv' } }),
    encoding: 'utf8',
  });
  assert.equal(mutation.status, 0, mutation.stderr);
  assert.match(mutation.stdout, /permissionDecision":"deny/);
  assert.match(mutation.stdout, /raw inputs are immutable/i);

  const bypass = spawnSync(process.execPath, [path.join(root, 'hooks', 'pre-tool-use.js')], {
    cwd,
    env,
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'python3 -c "print(1)"' } }),
    encoding: 'utf8',
  });
  assert.match(bypass.stdout, /kernel is the source of truth/i);
});

test('Stop hook blocks unresolved current errors but does not require publication', () => {
  const crypto = require('node:crypto');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lemma-stop-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lemma-stop-cwd-'));
  const env = { ...process.env, HOME: home };
  const activate = spawnSync(process.execPath, [path.join(root, 'hooks', 'post-tool-use.js')], {
    cwd,
    env,
    input: JSON.stringify({ tool_name: 'mcp__lemma__connect', tool_response: 'connected' }),
    encoding: 'utf8',
  });
  assert.equal(activate.status, 0, activate.stderr);

  const namespace = crypto.createHash('sha256').update(fs.realpathSync(cwd)).digest('hex').slice(0, 12);
  const taskDir = path.join(home, '.lemma', 'tasks', namespace);
  const taskPath = path.join(taskDir, 'active.json');
  fs.mkdirSync(taskDir, { recursive: true });
  const createdAt = new Date(Date.now() + 1000).toISOString();
  const task = {
    createdAt,
    updatedAt: createdAt,
    status: 'active',
    mutationRevision: 2,
    verifiedRevision: 1,
    unresolvedErrors: [{ id: 'cell-3', message: 'ValueError' }],
  };
  fs.writeFileSync(taskPath, JSON.stringify(task));

  const blocked = spawnSync(process.execPath, [path.join(root, 'hooks', 'stop.js')], {
    cwd,
    env,
    input: JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: false }),
    encoding: 'utf8',
  });
  assert.equal(blocked.status, 0, blocked.stderr);
  assert.notEqual(blocked.stdout, '', blocked.stderr);
  assert.deepEqual(JSON.parse(blocked.stdout).decision, 'block');
  assert.match(blocked.stdout, /unresolved cell error/i);

  fs.writeFileSync(taskPath, JSON.stringify({
    ...task,
    status: 'active',
    verifiedRevision: 2,
    unresolvedErrors: [],
  }));
  const unfinalized = spawnSync(process.execPath, [path.join(root, 'hooks', 'stop.js')], {
    cwd,
    env,
    input: JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: true }),
    encoding: 'utf8',
  });
  assert.equal(unfinalized.status, 0, unfinalized.stderr);
  assert.equal(unfinalized.stdout, '');
});

test('Stop hook gives one outcome reminder for missing evidence or chat answer', () => {
  const crypto = require('node:crypto');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lemma-outcome-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lemma-outcome-cwd-'));
  const env = { ...process.env, HOME: home };
  spawnSync(process.execPath, [path.join(root, 'hooks', 'post-tool-use.js')], {
    cwd,
    env,
    input: JSON.stringify({ tool_name: 'mcp__lemma__read', tool_response: '{}' }),
    encoding: 'utf8',
  });

  const namespace = crypto.createHash('sha256').update(fs.realpathSync(cwd)).digest('hex').slice(0, 12);
  const taskDir = path.join(home, '.lemma', 'tasks', namespace);
  fs.mkdirSync(taskDir, { recursive: true });
  const createdAt = new Date().toISOString();
  fs.writeFileSync(path.join(taskDir, 'active.json'), JSON.stringify({
    createdAt,
    executionCount: 0,
    cells: [],
    observations: [],
    unresolvedErrors: [],
  }));
  const transcript = path.join(cwd, 'transcript.jsonl');
  fs.writeFileSync(transcript, `${JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'mcp__lemma__read' }] },
  })}\n`);

  const first = spawnSync(process.execPath, [path.join(root, 'hooks', 'stop.js')], {
    cwd,
    env,
    input: JSON.stringify({ stop_hook_active: false, transcript_path: transcript }),
    encoding: 'utf8',
  });
  assert.equal(JSON.parse(first.stdout).decision, 'block');
  assert.match(first.stdout, /no executed or inspected notebook evidence/i);
  assert.match(first.stdout, /not yet in the chat/i);

  const repeated = spawnSync(process.execPath, [path.join(root, 'hooks', 'stop.js')], {
    cwd,
    env,
    input: JSON.stringify({ stop_hook_active: true, transcript_path: transcript }),
    encoding: 'utf8',
  });
  assert.equal(repeated.stdout, '');

  fs.writeFileSync(path.join(taskDir, 'active.json'), JSON.stringify({
    createdAt,
    executionCount: 1,
    cells: [{ cellId: 0, status: 'ok' }],
    observations: [],
    unresolvedErrors: [],
  }));
  fs.appendFileSync(transcript, `${JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: 'The result is 42 rows.' }] },
  })}\n`);
  const complete = spawnSync(process.execPath, [path.join(root, 'hooks', 'stop.js')], {
    cwd,
    env,
    input: JSON.stringify({ stop_hook_active: false, transcript_path: transcript }),
    encoding: 'utf8',
  });
  assert.equal(complete.stdout, '');
});

test('prompt-submit records a bounded project-scoped turn label', () => {
  const crypto = require('node:crypto');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lemma-turn-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'lemma-turn-cwd-'));
  const env = { ...process.env, HOME: home, LEMMA_HOST: 'claude' };
  const prompt = `Count the rows ${'x'.repeat(1500)}`;
  const result = spawnSync(process.execPath, [path.join(root, 'hooks', 'prompt-submit.js')], {
    cwd,
    env,
    input: JSON.stringify({ prompt }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const scope = crypto.createHash('sha256').update(fs.realpathSync(cwd)).digest('hex').slice(0, 12);
  const turn = JSON.parse(fs.readFileSync(path.join(home, '.lemma', `turn-${scope}.json`), 'utf8'));
  assert.ok(turn.id);
  assert.equal(turn.prompt.length, 1000);
  assert.ok(turn.beganAt);
});
