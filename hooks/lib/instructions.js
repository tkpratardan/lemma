// Shared persona reader for the hooks. src/mcp/server.ts deliberately does
// NOT import this: it's a separately-built TS package, so it carries its own
// small reader rather than reach across the hooks/compiled-src boundary.
'use strict';

const fs = require('fs');
const path = require('path');

// Developing lemma itself: the plugin-cache copy is frozen at install time,
// so prefer the working tree's AGENTS.md. Gated on plugin.json's name so a
// user project with its own AGENTS.md is never hijacked.
function devRoot() {
  const cwd = process.cwd();
  try {
    const plugin = JSON.parse(
        fs.readFileSync(path.join(cwd, '.claude-plugin', 'plugin.json'), 'utf8'));
    if (plugin.name === 'lemma' && fs.existsSync(path.join(cwd, 'AGENTS.md'))) {
      return cwd;
    }
  } catch {
    // Not the lemma repo.
  }
  return null;
}

function lemmaRoot() {
  // CLAUDE_PLUGIN_ROOT is only set on plugin installs; non-plugin installs
  // run from the repo itself, so this file's root is the right fallback.
  return devRoot() || process.env.CLAUDE_PLUGIN_ROOT ||
      path.dirname(path.dirname(__dirname));
}

function getFullPersona() {
  const agentsMd = path.join(lemmaRoot(), 'AGENTS.md');
  try {
    return fs.readFileSync(agentsMd, 'utf8').trim();
  } catch {
    return null;
  }
}

module.exports = { getFullPersona, lemmaRoot };
