#!/usr/bin/env node
// SubagentStart hook, Claude Code/Codex: SessionStart context is
// parent-thread only and never reaches a Task-spawned subagent, so without
// this every subagent runs lemma-unaware. Inject the same thin persona.
'use strict';

const { getFullPersona } = require('./lib/instructions.js');
const { emit } = require('./lib/envelope.js');

function main() {
  const agentsMd = getFullPersona();
  if (!agentsMd) {
    process.exit(0); // no AGENTS.md, emit nothing rather than break the subagent
  }
  const tag = "[lemma: data-science rigor, layered on top of this repo's own rules]\n\n";
  emit('subagentStart', tag + agentsMd);
}

main();
