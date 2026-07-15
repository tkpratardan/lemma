#!/usr/bin/env node
// Prompt-submit hook, all hosts: start a bounded passive turn record and end
// any discard pause. It injects no workflow or mode instructions.
'use strict';

const { clearDiscarded } = require('./lib/discardGate.js');
const { beginTurn, readPrompt } = require('./lib/turnState.js');

function main() {
  const prompt = readPrompt();
  beginTurn(prompt);
  clearDiscarded();
}

main();
