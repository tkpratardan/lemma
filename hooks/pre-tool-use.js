#!/usr/bin/env node
// Pre-tool-use hook, all hosts: while the discard gate is set, deny every
// tool call so a discard is a mechanical stop, not just tool-result text the
// model could choose to keep going past. Cleared by prompt-submit.js on the
// user's next message. Cursor registers this on beforeMCPExecution,
// beforeShellExecution, and beforeReadFile so any action type is blocked.
'use strict';

const fs = require('fs');

const { isDiscarded } = require('./lib/discardGate.js');
const {
  DENY_RAW_INPUT,
  DENY_REASON,
  isInlineInterpreter,
  isRawInputMutation,
  isShellDataMutation,
  isSurfaceActive,
} = require('./lib/dataGate.js');
const { HOST, emit } = require('./lib/envelope.js');

function main() {
  if (isDiscarded()) {
    emit('deny');
    process.exit(0);
  }

  // Command shape is confirmed for Claude/Codex only (envelope.js); Cursor
  // and Copilot input fields are unconfirmed, so this check silently no-ops
  // there rather than guess at field names.
  if ((HOST === 'claude' || HOST === 'codex') && isSurfaceActive()) {
    let event = {};
    try {
      event = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
    } catch {
      process.exit(0);
    }
    const toolName = event.tool_name ?? event.toolName;
    const toolInput = event.tool_input ?? event.toolInput ?? {};
    const command = toolInput.command;
    if (isRawInputMutation(toolName, toolInput) || (toolName === 'Bash' && isShellDataMutation(command))) {
      emit('deny', DENY_RAW_INPUT);
      process.exit(0);
    }
    if (toolName === 'Bash' && isInlineInterpreter(command)) {
      emit('deny', DENY_REASON);
    }
  }
  process.exit(0);
}

main();
