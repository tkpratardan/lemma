import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('shipped MCP bundle advertises only the canonical action interface', async () => {
  const bundle = fileURLToPath(new URL('../../../bin/lemma-mcp.mjs', import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundle, '--surface=vscode'],
    env: { ...process.env, LEMMA_NO_MCP_INSTRUCTIONS: '1' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'lemma-integration-test', version: '0.0.0' });
  try {
    await client.connect(transport);
    const listedTools = (await client.listTools()).tools;
    const tools = listedTools.map((tool) => tool.name).sort();
    assert.deepEqual(tools, [
      'connect',
      'edit',
      'inspect',
      'read',
      'run',
    ]);
    const connectSchema = JSON.stringify(
      listedTools.find((tool) => tool.name === 'connect')?.inputSchema
    );
    assert.match(connectSchema, /"begin"/);
    assert.match(connectSchema, /"expected_output"/);
    assert.doesNotMatch(connectSchema, /"quick"|"full"/);
    const inspectSchema = JSON.stringify(
      listedTools.find((tool) => tool.name === 'inspect')?.inputSchema
    );
    assert.match(inspectSchema, /"inventory"/);
    assert.match(inspectSchema, /"profile"/);
    assert.match(inspectSchema, /"batch"/);
    assert.match(inspectSchema, /"header_row"/);
    const prompts = (await client.listPrompts()).prompts.map((prompt) => prompt.name);
    assert.ok(prompts.includes('lemma_skill'));
  } finally {
    await client.close();
  }
});
