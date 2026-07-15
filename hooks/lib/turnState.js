// Minimal project-scoped turn context shared with the passive evidence ledger.
// It contains only an id, bounded prompt label, and timestamp—not a transcript.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scope = crypto.createHash('sha256').update(path.resolve(process.cwd())).digest('hex').slice(0, 12);
const TURN_FILE = path.join(os.homedir(), '.lemma', `turn-${scope}.json`);

function beginTurn(prompt = '') {
  try {
    const beganAt = new Date().toISOString();
    const state = {
      id: `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      prompt: String(prompt).trim().slice(0, 1000),
      beganAt,
    };
    fs.mkdirSync(path.dirname(TURN_FILE), { recursive: true });
    fs.writeFileSync(TURN_FILE, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    return state;
  } catch {
    return undefined;
  }
}

// Field name for the submitted prompt varies by host; try the common ones.
function readPrompt() {
  let event = {};
  try {
    event = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
  } catch { /* stdin empty or non-JSON */ }
  return event.prompt || event.message || '';
}

function clearTurn() {
  try {
    fs.unlinkSync(TURN_FILE);
  } catch { /* absent or unavailable */ }
}

module.exports = { beginTurn, clearTurn, readPrompt };
