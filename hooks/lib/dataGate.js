// Notebook enforcement: once a lemma notebook surface has been used this
// session, deny Bash calls that spin up an inline data-language interpreter
// (python -c, Rscript -e, ...), the mechanical way the kernel gets
// bypassed, regardless of data modality. Same cwd-scoped flag pattern as
// discardGate.js so concurrent sessions in different projects don't gate
// each other.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const scope = crypto.createHash('sha1').update(process.cwd()).digest('hex').slice(0, 12);
const FLAG_FILE = path.join(os.homedir(), '.lemma', `.surface-${scope}`);

const SURFACE_TOOL_RE = new RegExp(
  '^mcp__(plugin_lemma_lemma|lemma)__(?:' +
    '(vscode|pycharm|jupyterlab|notebook)_' +
    '|(connect|read|run|edit|inspect|checkpoint|verify_clean_run|publish_answer)$' +
  ')'
);

// Anything expressible in an inline interpreter is expressible as a cell.
// That equivalence is what makes this bright-line rather than a judgment
// call. A -c/-e flag or a piped heredoc, either is a bypass.
const INLINE_INTERPRETER_RE =
    /\b(python3?|ipython|Rscript|julia)\b[^|;&]*\s(-c|-e)\s|\|\s*(python3?|ipython|Rscript|julia)\b/;

const DENY_REASON =
    'lemma: the kernel is the source of truth. Run this in a notebook cell ' +
    "via lemma's tools instead of an inline interpreter.";

const DENY_RAW_INPUT =
    'lemma: raw inputs are immutable. Create a derived artifact from a notebook cell ' +
    'and record its lineage instead of editing the source file.';

const DATA_EXTENSION_RE = /\.(csv|tsv|parquet|feather|arrow|xlsx?|jsonl|ndjson|sav|dta|sas7bdat)$/i;
const RAW_DIRECTORY_RE = /(^|[\\/])(raw|raw[_-]data|source[_-]data|inputs?)([\\/]|$)/i;
const MUTATING_FILE_TOOL_RE = /(^|__)(write|edit|multiedit|apply_patch)$/i;
const SHELL_MUTATION_RE = /\b(sed\s+-i|perl\s+-pi|truncate|rm|unlink)\b|(^|[^>])>{1,2}(?!=)/i;

function setSurfaceActive() {
  try {
    fs.mkdirSync(path.dirname(FLAG_FILE), { recursive: true });
    if (!fs.existsSync(FLAG_FILE)) fs.writeFileSync(FLAG_FILE, String(Date.now()));
  } catch { /* non-fatal */ }
}

function isSurfaceActive() {
  try {
    return fs.readFileSync(FLAG_FILE, 'utf8').trim().length > 0;
  } catch {
    return false;
  }
}

// Cleared on SessionStart so a prior session's flag can't gate a fresh
// session that never connects a surface.
function clearSurface() {
  try {
    fs.unlinkSync(FLAG_FILE);
  } catch { /* already gone */ }
}

function surfaceActivatedAt() {
  try {
    const value = Number(fs.readFileSync(FLAG_FILE, 'utf8'));
    return Number.isFinite(value) ? value : fs.statSync(FLAG_FILE).mtimeMs;
  } catch {
    return undefined;
  }
}

function isSurfaceTool(toolName) {
  return typeof toolName === 'string' && SURFACE_TOOL_RE.test(toolName);
}

function isInlineInterpreter(command) {
  return typeof command === 'string' && INLINE_INTERPRETER_RE.test(command);
}

function candidatePaths(value, key = '') {
  if (typeof value === 'string') {
    return /(path|file|target|uri)/i.test(key) ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => candidatePaths(item, key));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([childKey, child]) => candidatePaths(child, childKey));
}

function isExistingDataPath(rawPath) {
  if (typeof rawPath !== 'string') return false;
  const absolute = path.resolve(rawPath);
  return RAW_DIRECTORY_RE.test(rawPath) || (DATA_EXTENSION_RE.test(rawPath) && fs.existsSync(absolute));
}

function isRawInputMutation(toolName, toolInput) {
  if (typeof toolName !== 'string' || !MUTATING_FILE_TOOL_RE.test(toolName)) return false;
  return candidatePaths(toolInput).some(isExistingDataPath);
}

function isShellDataMutation(command) {
  return typeof command === 'string' &&
    SHELL_MUTATION_RE.test(command) &&
    (DATA_EXTENSION_RE.test(command) || RAW_DIRECTORY_RE.test(command));
}

module.exports = {
  DENY_REASON,
  DENY_RAW_INPUT,
  clearSurface,
  isInlineInterpreter,
  isRawInputMutation,
  isShellDataMutation,
  isSurfaceActive,
  isSurfaceTool,
  setSurfaceActive,
  surfaceActivatedAt,
};

if (require.main === module) {
  const assert = require('assert');
  assert(isInlineInterpreter('python3 -c "import pandas as pd; print(pd.read_csv(\'x.csv\').shape)"'));
  assert(isInlineInterpreter('Rscript -e "read.csv(\'x.csv\')"'));
  assert(isInlineInterpreter('cat x.py | python3'));
  assert(!isInlineInterpreter('python3 script.py'));
  assert(!isInlineInterpreter('head -5 sales.csv'));
  assert(!isInlineInterpreter('grep -l revenue data/*.csv'));
  assert(!isInlineInterpreter('ls -la data/'));
  assert(isSurfaceTool('mcp__plugin_lemma_lemma__vscode_run_cell'));
  assert(isSurfaceTool('mcp__lemma__notebook_add_and_run'));
  assert(isSurfaceTool('mcp__lemma__connect'));
  assert(isSurfaceTool('mcp__plugin_lemma_lemma__verify_clean_run'));
  assert(!isSurfaceTool('mcp__lemma__lemma_skill'));
  assert(!isSurfaceTool('Bash'));
  assert(isRawInputMutation('Write', { file_path: 'data/raw/orders.csv' }));
  assert(isRawInputMutation('Edit', { file_path: 'inputs/orders.txt' }));
  assert(!isRawInputMutation('Write', { file_path: 'reports/new.csv' }));
  assert(isShellDataMutation('sed -i bak s/x/y/ data/raw/orders.csv'));
  assert(isShellDataMutation('rm inputs/source.parquet'));
  assert(!isShellDataMutation('head -5 data/raw/orders.csv'));
  console.log('dataGate self-check passed');
}
