// Shared lemma mode store for the prompt hooks: parse /lemma commands and
// persist the mode. The prompt hooks emit context only when the mode
// changes: UserPromptSubmit context accumulates in the transcript for the
// rest of the session, so emitting it every turn would compound. SessionStart
// already re-fires on compaction and covers drift on its own.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const FLAG_FILE = path.join(CLAUDE_DIR, '.lemma-active');

const MODES = new Set(['full', 'quick', 'off']);

function readMode() {
  try {
    const raw = fs.readFileSync(FLAG_FILE, 'utf8').trim();
    return MODES.has(raw) ? raw : 'full';
  } catch {
    return 'full';
  }
}

function writeMode(mode) {
  try {
    fs.mkdirSync(CLAUDE_DIR, { recursive: true });
    fs.writeFileSync(FLAG_FILE, mode);
  } catch { /* non-fatal */ }
}

// Field name for the submitted prompt varies by host; try the common ones.
function readPrompt() {
  let event = {};
  try {
    event = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  } catch { /* stdin empty or non-JSON — passthrough */ }
  return event.prompt || event.message || '';
}

// The new mode when this prompt changes it, else null.
function modeChange(prompt) {
  const lower = (prompt || '').toLowerCase();
  let next = null;
  const cmd = lower.match(/(?:^|\s)\/lemma(?:\s+(quick|full|off|on))?(?=\s|$)/);
  if (cmd) {
    next = cmd[1] === 'on' || !cmd[1] ? 'full' : cmd[1];
  }
  if (/stop lemma|disable lemma|lemma off/.test(lower)) {
    next = 'off';
  }
  if (!next || next === readMode()) {
    return null;
  }
  writeMode(next);
  return next;
}

module.exports = { modeChange, readMode, readPrompt };
