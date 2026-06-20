#!/usr/bin/env node
// Cursor beforeSubmitPrompt hook: a new user message ends the discard pause.
'use strict';

const { clearDiscarded } = require('./lib/discardGate.js');

clearDiscarded();
process.exit(0);
