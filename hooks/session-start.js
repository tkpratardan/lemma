#!/usr/bin/env node
// SessionStart hook: inject the data-scientist persona when no other channel
// does. Fires on startup|resume|clear|compact (hooks.json), so a compaction
// gets the persona back exactly when context loses it. Shared between Claude
// Code and Codex — host.js handles the output-framing difference.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { readMode } = require('./lib/activation.js');
const { getFullPersona } = require('./lib/instructions.js');
const { isCodex, writeSessionStartOutput } = require('./lib/host.js');

// Whether a client actually surfaces MCP instructions can't be observed
// from here, for any host, so only skip when a direct (non-plugin) config
// confirms the server is registered.
function mcpDeliversPersona() {
  if (isCodex || process.env.CLAUDE_PLUGIN_ROOT) {
    return false;
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    return Boolean(cfg.mcpServers && cfg.mcpServers.lemma);
  } catch {
    return false;
  }
}

function main() {
  if (readMode() === 'off' || mcpDeliversPersona()) {
    process.exit(0);
  }
  const agentsMd = getFullPersona();
  if (!agentsMd) {
    process.exit(0); // no AGENTS.md — emit nothing rather than break the session
  }
  const tag = "[lemma — data-science rigor, layered on top of this repo's own rules]\n\n";
  writeSessionStartOutput(tag + agentsMd);
}

main();
