#!/usr/bin/env node
'use strict';

const { setDiscarded, isDiscardSignal } = require('./lib/discardGate.js');

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
  }
  process.exit(0);
}

main();
