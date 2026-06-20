#!/usr/bin/env node
// UserPromptSubmit hook (Claude Code + Codex): track /lemma mode changes and
// announce only those. See hooks/copilot-prompt-submit.js for the Copilot
// CLI equivalent — same logic (hooks/lib/activation.js), different envelope.
'use strict';

const { modeChange, readPrompt } = require('./lib/activation.js');
const { clearDiscarded } = require('./lib/discardGate.js');

function main() {
  clearDiscarded();
  const next = modeChange(readPrompt());
  if (!next) {
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: next === 'off' ? '[lemma mode off]' : `[lemma mode: ${next}]`,
    },
  }) + '\n');
}

main();
