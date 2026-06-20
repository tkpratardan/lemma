#!/usr/bin/env node
// Copilot CLI postToolUse hook: flip the discard gate when a vscode_* result
// carries lemma's discard text. Reads both field-naming conventions Copilot
// CLI documents (camelCase and the VS Code-compatible snake_case).
'use strict';

const fs = require('fs');
const { setDiscarded, isDiscardSignal } = require('./lib/discardGate.js');

function main() {
  let event = {};
  try {
    event = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  } catch {
    process.exit(0);
  }
  const resultText =
    event.tool_result?.text_result_for_llm ?? event.toolResult?.textResultForLlm ?? '';
  if (isDiscardSignal(resultText)) {
    setDiscarded();
  }
  process.exit(0);
}

main();
