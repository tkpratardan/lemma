#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { setDiscarded, isDiscardSignal } = require('./lib/discardGate.js');

function main() {
  let event = {};
  try {
    event = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  } catch {
    process.exit(0);
  }
  if (isDiscardSignal(event.result_json)) {
    setDiscarded();
    process.stdout.write(JSON.stringify({ continue: false, permission: 'deny', userMessage: 'edit discarded', agentMessage: 'edit discarded' }));
  }
  process.exit(0);
}

main();
