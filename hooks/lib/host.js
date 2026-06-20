// Host detection for hook scripts shared across Claude Code and Codex (both
// run hooks/session-start.js and hooks/prompt-submit.js — see hooks/hooks.json,
// hooks/codex-hooks.json). PLUGIN_DATA is Codex's own plugin-state env var;
// Claude Code never sets it.
'use strict';

const isCodex = Boolean(process.env.PLUGIN_DATA);

// Claude Code's SessionStart hook injects raw stdout as hidden context
// directly. Codex needs the same text wrapped in its own JSON envelope, or
// the hook's output is dropped.
function writeSessionStartOutput(text) {
  if (isCodex) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text },
    }));
    return;
  }
  process.stdout.write(text);
}

module.exports = { isCodex, writeSessionStartOutput };
