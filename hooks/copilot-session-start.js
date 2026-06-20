#!/usr/bin/env node
// Copilot CLI sessionStart hook: inject the persona once at the start of
// every session. Dedicated script rather than sharing hooks/session-start.js's
// host-detection branch (hooks/lib/host.js): Copilot plugins have no
// confirmed env var for a hook script to detect its own host at runtime
// (only a command-string ${PLUGIN_ROOT} token) — the hooks.json entry
// pointing here is the detection. Output shape confirmed at
// github.com/en/copilot/reference/hooks-reference: flat { additionalContext }.
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
