#!/usr/bin/env node
// PreToolUse hook (Claude Code only): while the discard gate is set, deny
// every tool call so a discard is a mechanical stop, not just tool-result text
// the model could choose to keep going past. Cleared by prompt-submit.js on
// the user's next message.
'use strict';

const { isDiscarded } = require('./lib/discardGate.js');

function main() {
  if (!isDiscarded()) {
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'discarded',
    },
  }) + '\n');
}

main();
