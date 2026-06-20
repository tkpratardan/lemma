#!/usr/bin/env node
// Copilot CLI preToolUse hook: deny while the discard gate is set. Flat
// { permissionDecision, permissionDecisionReason } output, not Claude/Codex's
// nested hookSpecificOutput envelope (github.com/en/copilot/reference/hooks-reference).
'use strict';

const { isDiscarded } = require('./lib/discardGate.js');

function main() {
  if (!isDiscarded()) {
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    permissionDecision: 'deny',
    permissionDecisionReason: 'discarded',
  }));
}

main();
