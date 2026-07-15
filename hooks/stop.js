#!/usr/bin/env node
// Claude/Codex Stop hook: enforce observable outcomes, never a tool sequence.
// Missing evidence/chat output gets one concise reminder. Unresolved execution
// errors remain blocking because they invalidate the evidence itself.
'use strict';

const fs = require('fs');
const {
  completionProblem,
  lastAssistantAnswer,
  readActiveTask,
  taskBeganAfter,
} = require('./lib/completionGate.js');
const { isSurfaceActive, surfaceActivatedAt } = require('./lib/dataGate.js');

function main() {
  if (!isSurfaceActive()) process.exit(0);
  let event = {};
  try {
    event = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  } catch {
    process.exit(0);
  }
  const task = readActiveTask();
  if (!taskBeganAfter(task, surfaceActivatedAt())) process.exit(0);
  const errors = Array.isArray(task?.unresolvedErrors) ? task.unresolvedErrors.length : 0;
  const problem = completionProblem(task, {
    hasAssistantAnswer: lastAssistantAnswer(event.transcript_path),
  });
  if (!problem) process.exit(0);

  // The host sets stop_hook_active on the continuation caused by this hook.
  // Let an outcome reminder fire once; broken execution remains a hard gate.
  if (event.stop_hook_active && errors === 0) process.exit(0);

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: event.stop_hook_active ? `Still unresolved: ${problem}` : problem,
  }) + '\n');
}

main();
