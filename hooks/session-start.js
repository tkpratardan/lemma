#!/usr/bin/env node
// SessionStart hook, all hosts: inject the persona once per session. On
// Claude Code/Codex it also fires on compaction (hooks.json matcher), so the
// persona comes back exactly when context loses it.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { clearSurface } = require('./lib/dataGate.js');
const { getFullPersona } = require('./lib/instructions.js');
const { HOST, emit } = require('./lib/envelope.js');
const { clearTurn } = require('./lib/turnState.js');

// Whether a client actually surfaces MCP instructions can't be observed
// from here, for any host, so only skip when a direct (non-plugin) config
// confirms the server is registered.
function mcpDeliversPersona() {
  if (HOST === 'codex' || process.env.CLAUDE_PLUGIN_ROOT) {
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
  let event = {};
  try {
    event = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  } catch { /* hosts without structured SessionStart input */ }
  // Compaction is the same task and must retain its mechanical gates.
  if (event.source !== 'compact') {
    clearSurface();
    clearTurn();
  }
  // Direct Claude configuration may already deliver MCP instructions. Plugin
  // routes deliberately use this hook, so do not suppress those.
  const gated = HOST === 'claude' || HOST === 'codex';
  if (gated && mcpDeliversPersona()) {
    process.exit(0);
  }
  const agentsMd = getFullPersona();
  if (!agentsMd) {
    process.exit(0); // no AGENTS.md, emit nothing rather than break the session
  }
  const tag = "[lemma: data-science rigor, layered on top of this repo's own rules]\n\n";
  emit('sessionStart', tag + agentsMd);
}

main();
