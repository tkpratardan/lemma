#!/usr/bin/env node
// Cursor before* hooks (beforeMCPExecution, beforeShellExecution,
// beforeReadFile): deny while the discard gate is set. Registered on all
// three so any action type is blocked, not just another MCP call.
'use strict';

const { isDiscarded } = require('./lib/discardGate.js');

function main() {
  if (!isDiscarded()) {
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    permission: 'deny',
    user_message: 'discarded',
    agent_message: 'discarded',
  }));
}

main();
