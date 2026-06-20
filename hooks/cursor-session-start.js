#!/usr/bin/env node
// Cursor sessionStart hook: inject the persona once at the start of every
// session. Flat { additionalContext }, not Claude/Codex's nested
// hookSpecificOutput envelope.
'use strict';

const { getFullPersona } = require('./lib/instructions.js');

function main() {
  const agentsMd = getFullPersona();
  if (!agentsMd) {
    process.exit(0); // no AGENTS.md — emit nothing rather than break the session
  }
  const tag = "[lemma — data-science rigor, layered on top of this repo's own rules]\n\n";
  process.stdout.write(JSON.stringify({ additionalContext: tag + agentsMd }));
}

main();
