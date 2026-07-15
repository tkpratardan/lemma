'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

test('editor-specific plugin configs prefer the VS Code surface', () => {
  const copilot = readJson('.github/plugin/mcp.json');
  const gemini = readJson('gemini-extension.json');
  assert.ok(copilot.mcpServers.lemma.args.includes('--surface=vscode'));
  assert.ok(gemini.mcpServers.lemma.args.includes('--surface=vscode'));
  assert.deepEqual(gemini.mcpServers.lemma.includeTools, [
    'connect', 'read', 'run', 'edit', 'inspect',
  ]);
});
