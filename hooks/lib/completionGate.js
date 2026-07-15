// Outcome checks shared by the Stop hook. They inspect only observable state:
// recorded notebook evidence, unresolved errors, and the last assistant event.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const namespace = crypto.createHash('sha256').update(path.resolve(process.cwd())).digest('hex').slice(0, 12);
const ACTIVE_TASK = path.join(os.homedir(), '.lemma', 'tasks', namespace, 'active.json');

function readActiveTask() {
  try {
    return JSON.parse(fs.readFileSync(ACTIVE_TASK, 'utf8'));
  } catch {
    return undefined;
  }
}

function taskBeganAfter(task, timestamp) {
  const created = Date.parse(task?.createdAt ?? '');
  // Lazy attachment creates the ledger just before PostToolUse records surface
  // activation. A small tolerance preserves that same action without admitting
  // a stale task from a prior session (SessionStart clears the surface flag).
  return Number.isFinite(created) && timestamp !== undefined && created + 5000 >= timestamp;
}

function hasEvidence(task) {
  return Boolean(
    Number(task?.executionCount ?? 0) > 0 ||
    (Array.isArray(task?.cells) && task.cells.length > 0) ||
    (Array.isArray(task?.observations) && task.observations.length > 0) ||
    Number(task?.finalization?.evidenceCount ?? 0) > 0
  );
}

function lastAssistantAnswer(transcriptPath) {
  if (!transcriptPath) return undefined;
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return undefined;
  }
  const records = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch { /* tolerate non-event lines */ }
  }
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record?.type !== 'assistant' && record?.role !== 'assistant' && record?.message?.role !== 'assistant') continue;
    const content = record?.message?.content ?? record?.content;
    if (typeof content === 'string') return content.trim().length > 0;
    if (!Array.isArray(content)) return false;
    const hasToolUse = content.some((block) => block?.type === 'tool_use' || block?.type === 'tool_call');
    const answer = content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text.trim())
      .filter(Boolean)
      .join('\n');
    return !hasToolUse && answer.length > 0;
  }
  return false;
}

function completionProblem(task, options = {}) {
  if (!task) return undefined;
  const errors = Array.isArray(task.unresolvedErrors) ? task.unresolvedErrors.length : 0;
  if (errors > 0) {
    return `Lemma task has ${errors} unresolved cell error(s). Resolve them before completion.`;
  }
  const missing = [];
  if (!hasEvidence(task)) missing.push('no executed or inspected notebook evidence was recorded');
  if (options.hasAssistantAnswer === false) missing.push('the requested result is not yet in the chat');
  if (missing.length) {
    return `Before finishing: ${missing.join('; ')}. Return the bounded answer with its scope; an artifact alone is not the answer.`;
  }
  return undefined;
}

module.exports = { completionProblem, hasEvidence, lastAssistantAnswer, readActiveTask, taskBeganAfter };
