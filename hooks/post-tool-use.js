#!/usr/bin/env node
// Post-tool-use hook, all hosts: track surface activation and set the discard
// gate when a tool result carries lemma's discard text. Analytical judgment
// stays in the persona/skill loop; repeating generic context after every cell
// only pollutes long notebook trajectories.
'use strict';

const fs = require('fs');

const { setDiscarded, isDiscardSignal } = require('./lib/discardGate.js');
const { isSurfaceTool, setSurfaceActive } = require('./lib/dataGate.js');
const { HOST, emit } = require('./lib/envelope.js');

// Copilot documents both camelCase and VS Code-compatible snake_case fields.
function toolResult(event) {
  if (HOST === 'copilot') {
    return event.tool_result?.text_result_for_llm ?? event.toolResult?.textResultForLlm ?? '';
  }
  if (HOST === 'cursor') {
    return event.result_json;
  }
  return event.tool_response;
}

function main() {
  let event = {};
  try {
    event = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  } catch {
    process.exit(0);
  }
  const toolName = event.tool_name ?? event.toolName;
  if (isSurfaceTool(toolName)) {
    setSurfaceActive();
  }
  if (isDiscardSignal(toolResult(event))) {
    setDiscarded();
    emit('discardStop');
  }
  process.exit(0);
}

main();
