// Flag file coordinating PostToolUse (sets it on a vscode_* discard),
// PreToolUse (denies while set), and UserPromptSubmit (clears it). Scoped by
// cwd so concurrent sessions in different projects can't block each other —
// a discard in one project must not freeze tool calls in an unrelated one.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const scope = crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
const FLAG_FILE = path.join(os.homedir(), '.lemma', `.discarded-${scope}`);

function setDiscarded() {
  try {
    fs.mkdirSync(path.dirname(FLAG_FILE), { recursive: true });
    fs.writeFileSync(FLAG_FILE, '1');
  } catch { /* non-fatal */ }
}

function isDiscarded() {
  try {
    return fs.readFileSync(FLAG_FILE, 'utf8').trim() === '1';
  } catch {
    return false;
  }
}

function clearDiscarded() {
  try {
    fs.unlinkSync(FLAG_FILE);
  } catch { /* already gone */ }
}

// `raw` is a tool result in whatever shape a host hands it: lemma's own
// `text('discarded')` as a bare string, or a host's JSON-stringified content
// array wrapping it. Exact-matched (not a bare `.includes('discarded')`) so
// unrelated tool output that happens to contain that word can't false-trigger.
function isDiscardSignal(raw) {
  const s = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '');
  return s === 'discarded' || s === '"discarded"' || s.includes('"text":"discarded"');
}

module.exports = { setDiscarded, isDiscarded, clearDiscarded, isDiscardSignal };
