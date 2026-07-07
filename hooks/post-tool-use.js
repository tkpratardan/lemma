#!/usr/bin/env node
'use strict';

const { setDiscarded, isDiscardSignal } = require('./lib/discardGate.js');
const { isMutatingNotebookTool, NUDGE_TEXT } = require('./lib/nudge.js');

function main() {
  let event = {};
  try {
    event = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
  } catch {
    process.exit(0);
  }
  if (isDiscardSignal(event.tool_response)) {
    setDiscarded();
    process.stdout.write(JSON.stringify({ continue: false, stopReason: 'edit discarded' }) + '\n');
  } else if (isMutatingNotebookTool(event.tool_name)) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: NUDGE_TEXT },
    }) + '\n');
  }
  process.exit(0);
}

main();
