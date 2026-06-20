// Shared lemma persona reader — single source of truth for "what to say",
// kept separate from "where/when to say it" (that part is each hook's job).
// Used today by hooks/session-start.js (Claude Code). src/mcp/server.ts's
// MCP-level fallback (the `instructions` field + `lemma_persona` prompt)
// deliberately does NOT import this: it lives in a separately-built TS
// package, so it carries its own small reader instead of reaching across
// the hooks/ <-> compiled-src/ runtime boundary.
'use strict';

const fs = require('fs');
const path = require('path');

function lemmaRoot() {
  // CLAUDE_PLUGIN_ROOT is set by Claude Code when running as a plugin.
  // Fall back to this file's repo root (hooks/lib/.. /..) for non-plugin
  // installs (e.g. bin/install.js's global-hooks path, which substitutes an
  // absolute path at install time the same way).
  return process.env.CLAUDE_PLUGIN_ROOT || path.dirname(path.dirname(__dirname));
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
