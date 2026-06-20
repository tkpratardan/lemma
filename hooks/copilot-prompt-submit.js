#!/usr/bin/env node
// Copilot CLI userPromptSubmitted hook: same mode tracking as
// hooks/prompt-submit.js (hooks/lib/activation.js), but Copilot's confirmed
// context-injection shape is a flat { additionalContext }, not Claude/Codex's
// nested hookSpecificOutput envelope (github.com/en/copilot/reference/hooks-reference).
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
    additionalContext: next === 'off' ? '[lemma mode off]' : `[lemma mode: ${next}]`,
  }));
}

main();
