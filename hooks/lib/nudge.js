'use strict';

const MUTATING_RE = /_(add_and_run|edit_and_run|run_cell|run_all_cells|execute_cell)$/;
const NUDGE_TEXT = 'Still serving the stated goal? Revise the plan if this finding changed it.';

function isMutatingNotebookTool(toolName) {
  return typeof toolName === 'string' && MUTATING_RE.test(toolName);
}

module.exports = { isMutatingNotebookTool, NUDGE_TEXT };
