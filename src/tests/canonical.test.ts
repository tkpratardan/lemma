import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JupyterlabHandlers } from '../adapters/jupyterlab/tools.js';
import type { PyCharmAllHandlers } from '../adapters/pycharm/tools.js';
import { imageBlock, text } from '../utils/response.js';
import { changedVariables, registerCanonicalTools } from '../mcp/canonical.js';
import { TaskStore } from '../mcp/taskState.js';

function handlers(): JupyterlabHandlers {
  return {
    readNotebook: () => text('{}'),
    getState: () => text('{"cells":[],"variables":{}}'),
    addAndRun: async () => text('cell 0 added+ran'),
    runCell: async () => text('[no output]'),
    readCellOutput: () => text('[no output]'),
    editAndRun: async () => text('cell 0 edited+ran'),
    runAllCells: async () => text('ran 1/1 code cells'),
    inspectVariable: async () => text('value'),
    editCell: () => text('edited'),
    insertCell: () => text('inserted'),
    deleteCell: () => text('deleted'),
    addMarkdown: () => text('added'),
    clearNotebook: () => text('cleared'),
    restartKernel: async () => text('restarted'),
    saveNotebook: () => text('saved'),
  };
}

function connectArguments(
  goal: string,
  shape: 'scalar' | 'list' | 'table' | 'narrative' | 'report' | 'artifact' = 'narrative'
) {
  return {
    server_url: 'http://test',
    notebook_file: '/tmp/test.ipynb',
    begin: { goal, expected_output: { shape } },
  };
}

test('default canonical registration exposes only the five analysis tools', () => {
  const base = mkdtempSync(join(tmpdir(), 'lemma-canonical-'));
  try {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerCanonicalTools(server, {
      preferredSurface: 'jupyter',
      jupyterlab: handlers(),
      taskStore: new TaskStore('/workspace/example', base),
    });
    const registered = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools
    ).sort();
    assert.deepEqual(registered, [
      'connect',
      'edit',
      'inspect',
      'read',
      'run',
    ]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('audit lifecycle tools are available only when explicitly enabled', () => {
  const base = mkdtempSync(join(tmpdir(), 'lemma-canonical-audit-'));
  try {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerCanonicalTools(server, {
      preferredSurface: 'jupyter',
      jupyterlab: handlers(),
      taskStore: new TaskStore('/workspace/example', base),
      includeAuditTools: true,
    });
    const registered = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools
    ).sort();
    assert.deepEqual(registered, [
      'checkpoint', 'connect', 'edit', 'inspect', 'publish_answer', 'read', 'run', 'verify_clean_run',
    ]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('changedVariables reports added, updated, and removed names', () => {
  assert.deepEqual(
    changedVariables({ kept: 1, changed: { rows: 2 }, gone: true }, { kept: 1, changed: { rows: 3 }, added: 4 }),
    { added: ['added'], updated: ['changed'], removed: ['gone'] }
  );
});

test('analysis actions attach lazily and record notebook, cell, observation, and artifact evidence', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lemma-canonical-lazy-'));
  const artifactPath = join(base, 'result.csv');
  let connectCalls = 0;
  let restartCalls = 0;
  let state = {
    uri: '/workspace/example/analysis.ipynb',
    cells: [] as Array<Record<string, unknown>>,
    variables: {} as Record<string, unknown>,
  };
  const fake: PyCharmAllHandlers = {
    ...handlers(),
    connect: async () => {
      connectCalls += 1;
      return text('connected to test notebook');
    },
    status: () => text('connected'),
    executeCell: async () => text('unused'),
    probe: async () => text('unused'),
    insertCell: () => text('inserted'),
    restartKernel: async () => {
      restartCalls += 1;
      return text('restarted');
    },
    getState: () => text(JSON.stringify(state)),
    addAndRun: async ({ source }) => {
      writeFileSync(artifactPath, 'answer\n42\n');
      state = {
        ...state,
        cells: [{ index: 0, executionCount: 1, error: null, source }],
        variables: { answer: { type: 'int', value: 42 } },
      };
      return text('cell 0 added+ran\n42');
    },
  };
  const store = new TaskStore('/workspace/example', base);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerCanonicalTools(server, {
    preferredSurface: 'pycharm',
    pycharm: fake,
    taskStore: store,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const runResponse = await client.callTool({
      name: 'run',
      arguments: { mode: 'append', source: `df.to_csv('${artifactPath}')` },
    });
    const runBlock = (runResponse as { content: Array<{ type: string; text?: string }> }).content[0];
    assert.equal(JSON.parse(runBlock.text ?? '{}').status, 'ok');
    await client.callTool({ name: 'read', arguments: { kind: 'state' } });

    assert.equal(connectCalls, 1);
    assert.equal(restartCalls, 0, 'lazy attachment must not destroy notebook state');
    const ledger = store.requireActive();
    assert.equal(ledger.notebook?.uri, '/workspace/example/analysis.ipynb');
    assert.equal(ledger.notebook?.lazy, true);
    assert.equal(ledger.cells.length, 1);
    assert.equal(ledger.cells[0].cellId, 0);
    assert.ok(ledger.cells[0].sourceHash);
    assert.ok(ledger.cells[0].outputHash);
    assert.equal(ledger.observations[0].kind, 'state');
    assert.equal(ledger.artifacts[0].uri, artifactPath);
  } finally {
    await client.close();
    await server.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test('run returns its execution result and compact state delta in one response', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lemma-canonical-run-'));
  let state = { cells: [] as Array<Record<string, unknown>>, variables: {} as Record<string, unknown> };
  const fake: PyCharmAllHandlers = {
    ...handlers(),
    connect: async () => text('connected to test notebook'),
    status: () => text('connected'),
    executeCell: async () => text('unused'),
    probe: async () => text('unused'),
    insertCell: () => text('inserted'),
    getState: () => text(JSON.stringify(state)),
    addAndRun: async () => {
      state = {
        cells: [{ index: 0, executionCount: 1, error: null }],
        variables: { answer: { type: 'int', value: 12 } },
      };
      return text('cell 0 added+ran\n12');
    },
  };
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerCanonicalTools(server, {
    preferredSurface: 'pycharm',
    pycharm: fake,
    taskStore: new TaskStore('/workspace/example', base),
    includeAuditTools: true,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const begunResponse = await client.callTool({
      name: 'connect',
      arguments: connectArguments('count rows', 'scalar'),
    });
    const begunBlock = (begunResponse as { content: Array<{ type: string; text?: string }> }).content[0];
    const begun = JSON.parse(begunBlock.text ?? '{}');
    assert.equal(begun.task.status, 'active');
    assert.equal(begun.task.executions, 0);
    assert.equal('controller' in begun, false);
    assert.ok((begunBlock.text ?? '').length < 1000);
    await client.callTool({ name: 'read', arguments: { kind: 'state' } });
    const response = await client.callTool({
      name: 'run',
      arguments: { mode: 'append', source: 'answer = 12\nanswer' },
    });
    const block = (response as { content: Array<{ type: string; text?: string }> }).content[0];
    assert.equal(block.type, 'text');
    const delta = JSON.parse(block.type === 'text' ? (block.text ?? '{}') : '{}');
    assert.equal(delta.status, 'ok');
    assert.deepEqual(delta.changed_variables.added, ['answer']);
    assert.equal(delta.cell.id, 0);
    assert.equal(delta.output.summary, 'cell 0 added+ran\n12');
    assert.deepEqual(delta.output.full_result, { action: 'read', kind: 'output', index: 0 });
    assert.deepEqual(delta.task, { id: begun.task.id });
    assert.equal('controller' in delta, false);

    const recordedResponse = await client.callTool({
      name: 'checkpoint',
      arguments: {
        record: {
          validated_facts: [{ statement: 'There are 12 rows.', evidence: 'cell 0, revision 1' }],
        },
      },
    });
    const recordedBlock = (recordedResponse as { content: Array<{ type: string; text?: string }> }).content[0];
    const recorded = JSON.parse(recordedBlock.text ?? '{}');
    assert.equal(recorded.task.counts.facts, 1);
    assert.doesNotMatch(recordedBlock.text ?? '', /There are 12 rows/);
    assert.ok((recordedBlock.text ?? '').length < 1000);

    const unsupportedResponse = await client.callTool({
      name: 'publish_answer',
      arguments: {
        result: { shape: 'scalar', value: 12, unit: 'rows' },
        evidence: [{ kind: 'cell', cell_id: 99, revision: delta.cell.revision }],
      },
    });
    const unsupportedBlock = (unsupportedResponse as { content: Array<{ type: string; text?: string }> }).content[0];
    const unsupported = JSON.parse(unsupportedBlock.text ?? '{}');
    assert.equal(unsupported.status, 'blocked');
    assert.match(unsupported.error, /cell 99 on pycharm does not exist or has not executed/i);

    const finalizedResponse = await client.callTool({
      name: 'publish_answer',
      arguments: {
        result: { shape: 'scalar', value: 12, unit: 'rows' },
        evidence: [{ kind: 'cell', cell_id: 0, revision: delta.cell.revision }],
      },
    });
    const finalizedBlock = (finalizedResponse as { content: Array<{ type: string; text?: string }> }).content[0];
    const finalized = JSON.parse(finalizedBlock.text ?? '{}');
    assert.equal(finalized.status, 'recorded');
    assert.equal(finalized.task.status, 'complete');
    assert.equal('answer' in finalized, false);
    assert.equal('instruction' in finalized, false);
    assert.equal('next' in finalized, false);
    assert.ok((finalizedBlock.text ?? '').length < 500);
  } finally {
    await client.close();
    await server.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test('read selects stored images without attaching every visualization by default', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lemma-canonical-read-images-'));
  const fake: PyCharmAllHandlers = {
    ...handlers(),
    connect: async () => text('connected to test notebook'),
    status: () => text('connected'),
    executeCell: async () => text('unused'),
    probe: async () => text('unused'),
    insertCell: () => text('inserted'),
    readCellOutput: () => ({
      content: [
        { type: 'text', text: 'cell 0 output\nplot summary' },
        imageBlock('Zmlyc3QtaW1hZ2U=', 'image/png'),
        imageBlock('c2Vjb25kLWltYWdl', 'image/jpeg'),
      ],
    }),
  };
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerCanonicalTools(server, {
    preferredSurface: 'pycharm',
    pycharm: fake,
    taskStore: new TaskStore('/workspace/example', base),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await client.callTool({
      name: 'connect',
      arguments: connectArguments('inspect a visualization'),
    });

    const textOnly = await client.callTool({
      name: 'read',
      arguments: { kind: 'output', index: 0 },
    });
    const textBlocks = (textOnly as { content: Array<{ type: string; text?: string }> }).content;
    assert.equal(textBlocks.some((block) => block.type === 'image'), false);
    assert.match(textBlocks.map((block) => block.text ?? '').join('\n'), /image outputs: 2/);

    const metadataResponse = await client.callTool({
      name: 'read',
      arguments: { kind: 'output', index: 0, content: 'metadata' },
    });
    const metadataBlock = (metadataResponse as { content: Array<{ type: string; text?: string }> }).content[0];
    const metadata = JSON.parse(metadataBlock.text ?? '{}');
    assert.equal(metadata.image_count, 2);
    assert.deepEqual(metadata.images.map((item: { mime_type: string }) => item.mime_type), [
      'image/png',
      'image/jpeg',
    ]);

    const selectedResponse = await client.callTool({
      name: 'read',
      arguments: { kind: 'output', index: 0, content: 'images', image_index: 1 },
    });
    const selectedBlocks = (selectedResponse as {
      content: Array<{ type: string; data?: string; mimeType?: string }>;
    }).content;
    const selectedImages = selectedBlocks.filter((block) => block.type === 'image');
    assert.equal(selectedImages.length, 1);
    assert.equal(selectedImages[0].data, 'c2Vjb25kLWltYWdl');
    assert.equal(selectedImages[0].mimeType, 'image/jpeg');
  } finally {
    await client.close();
    await server.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test('run and edit can execute and return a selected visualization in one call', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lemma-canonical-execution-images-'));
  let state = {
    cells: [{ index: 0, executionCount: 1, error: null }],
    variables: {} as Record<string, unknown>,
  };
  const storedImages = () => ({
    content: [
      { type: 'text' as const, text: 'rendered two plots' },
      imageBlock('Zmlyc3QtaW1hZ2U=', 'image/png'),
      imageBlock('c2Vjb25kLWltYWdl', 'image/png'),
    ],
  });
  const fake: PyCharmAllHandlers = {
    ...handlers(),
    connect: async () => text('connected to test notebook'),
    status: () => text('connected'),
    executeCell: async () => text('unused'),
    probe: async () => text('unused'),
    insertCell: () => text('inserted'),
    getState: () => text(JSON.stringify(state)),
    readCellOutput: storedImages,
    addAndRun: async () => {
      state = {
        cells: [...state.cells, { index: 1, executionCount: 1, error: null }],
        variables: { chart: { type: 'Figure' } },
      };
      return text('cell 1 added+ran\n[image output]');
    },
    editAndRun: async ({ index }) => {
      state = {
        ...state,
        cells: state.cells.map((cell) =>
          cell.index === index ? { ...cell, executionCount: 2 } : cell
        ),
      };
      return text(`cell ${index} edited+ran\n[image output]`);
    },
  };
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerCanonicalTools(server, {
    preferredSurface: 'pycharm',
    pycharm: fake,
    taskStore: new TaskStore('/workspace/example', base),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await client.callTool({
      name: 'connect',
      arguments: connectArguments('create and revise a visualization'),
    });
    await client.callTool({ name: 'read', arguments: { kind: 'state' } });

    const runResponse = await client.callTool({
      name: 'run',
      arguments: {
        mode: 'append',
        source: 'chart = make_chart()',
        return_output: 'images',
      },
    });
    const runBlocks = (runResponse as {
      content: Array<{ type: string; text?: string; data?: string }>;
    }).content;
    assert.equal(runBlocks.filter((block) => block.type === 'image').length, 1);
    assert.equal(runBlocks.find((block) => block.type === 'image')?.data, 'Zmlyc3QtaW1hZ2U=');
    const runDelta = JSON.parse(runBlocks[0].text ?? '{}');
    assert.equal(runDelta.cell.id, 1);
    assert.deepEqual(runDelta.changed_variables.added, ['chart']);

    const editResponse = await client.callTool({
      name: 'edit',
      arguments: {
        operation: 'replace',
        index: 0,
        source: 'chart = make_better_chart()',
        execute: true,
        return_output: 'images',
        image_index: 1,
      },
    });
    const editBlocks = (editResponse as {
      content: Array<{ type: string; text?: string; data?: string }>;
    }).content;
    const editImages = editBlocks.filter((block) => block.type === 'image');
    assert.equal(editImages.length, 1);
    assert.equal(editImages[0].data, 'c2Vjb25kLWltYWdl');
    const editDelta = JSON.parse(editBlocks[0].text ?? '{}');
    assert.equal(editDelta.cell.id, 0);
    assert.equal(editDelta.cell.execution_count, 2);

    const missingImageResponse = await client.callTool({
      name: 'edit',
      arguments: {
        operation: 'replace',
        index: 0,
        source: 'chart = make_better_chart()',
        execute: true,
        return_output: 'images',
        image_index: 9,
      },
    });
    const missingImageBlock = (missingImageResponse as {
      content: Array<{ type: string; text?: string }>;
    }).content[0];
    const missingImageDelta = JSON.parse(missingImageBlock.text ?? '{}');
    assert.equal(missingImageDelta.status, 'ok');
    assert.match(missingImageDelta.warnings[0], /execution succeeded.*image_index=9/i);
  } finally {
    await client.close();
    await server.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test('connect preserves kernel state by default and batch inspection reuses one durable source helper', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lemma-canonical-source-inspect-'));
  const capturedSources: string[] = [];
  let restartCalls = 0;
  let state = { cells: [] as Array<Record<string, unknown>>, variables: {} as Record<string, unknown> };
  const fake: PyCharmAllHandlers = {
    ...handlers(),
    connect: async () => text('connected to test notebook'),
    status: () => text('connected'),
    executeCell: async () => text('unused'),
    probe: async () => text('unused'),
    insertCell: () => text('inserted'),
    restartKernel: async () => {
      restartCalls += 1;
      return text('restarted');
    },
    getState: () => text(JSON.stringify(state)),
    addAndRun: async ({ source }) => {
      capturedSources.push(source);
      const index = state.cells.length;
      state = {
        cells: [...state.cells, { index, executionCount: 1, error: null }],
        variables: { _lemma_source_observation: { type: 'dict' } },
      };
      const observation = index === 0
        ? {
            view: 'batch',
            observations: [
              { view: 'schema', path: 'data/orders.csv', rows: 12, columns: 3, header_row: 0, schema: [] },
              {
                view: 'schema',
                path: 'data/climate.xlsx',
                rows: 99,
                columns: 30,
                header_row: 5,
                sheets: ['Sheet1'],
                header_candidates: [{ row_index: 5, values: ['Site', 'Age_ky'] }],
                raw_preview: [],
                schema: [],
              },
            ],
          }
        : { view: 'head', path: 'data/orders.csv', rows: 12, columns: 3, header_row: 0, records: [] };
      return text(`cell ${index} added+ran\n${JSON.stringify(observation)}`);
    },
  };
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerCanonicalTools(server, {
    preferredSurface: 'pycharm',
    pycharm: fake,
    taskStore: new TaskStore('/workspace/example', base),
    includeAuditTools: true,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const connectedResponse = await client.callTool({
      name: 'connect',
      arguments: connectArguments('inspect source schema'),
    });
    const connectedBlock = (connectedResponse as { content: Array<{ type: string; text?: string }> }).content[0];
    const connected = JSON.parse(connectedBlock.text ?? '{}');
    assert.equal(connected.status, 'connected');
    assert.equal(connected.task.status, 'active');
    assert.equal(connected.kernel_reset, false);
    assert.equal('controller' in connected, false);
    assert.equal(restartCalls, 0);

    const response = await client.callTool({
      name: 'inspect',
      arguments: {
        source: {
          view: 'batch',
          requests: [
            { view: 'schema', path: 'data/orders.csv' },
            { view: 'schema', path: 'data/climate.xlsx', sheet: 0, header_row: 'auto' },
          ],
        },
      },
    });
    const block = (response as { content: Array<{ type: string; text?: string }> }).content[0];
    assert.doesNotMatch(block.text ?? '', /^MCP error/, block.text);
    const delta = JSON.parse(block.text ?? '{}');
    assert.equal(delta.status, 'ok');
    assert.equal(delta.cell.id, 0);
    assert.equal(delta.output.observation.view, 'batch');
    assert.equal(delta.output.observation.observations.length, 2);
    assert.equal(delta.output.observation.observations[0].path, 'data/orders.csv');
    assert.equal(delta.output.observation.observations[1].path, 'data/climate.xlsx');
    assert.equal(delta.output.observation.observations[1].header_row, 5);
    assert.ok((block.text ?? '').length < 4000);
    assert.match(capturedSources[0], /def _lemma_inspect_source/);
    assert.match(capturedSources[0], /# Lemma deterministic source batch/);
    assert.match(capturedSources[0], /data\/orders\.csv/);
    assert.match(capturedSources[0], /data\/climate\.xlsx/);

    await client.callTool({
      name: 'inspect',
      arguments: { source: { view: 'head', path: 'data/orders.csv', rows: 3 } },
    });
    assert.equal(capturedSources.length, 2);
    assert.doesNotMatch(capturedSources[1], /def _lemma_inspect_source/);
    assert.ok(capturedSources[1].length < 1000);

    const statusResponse = await client.callTool({
      name: 'checkpoint',
      arguments: { status: { section: 'sources' } },
    });
    const statusBlock = (statusResponse as { content: Array<{ type: string; text?: string }> }).content[0];
    const status = JSON.parse(statusBlock.text ?? '{}');
    assert.equal(status.items.length, 2);
    assert.deepEqual(status.items.map((item: { uri: string }) => item.uri).sort(), [
      'data/climate.xlsx',
      'data/orders.csv',
    ]);
  } finally {
    await client.close();
    await server.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test('an explicit connect can switch surfaces mid-turn without losing evidence or resetting kernels', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lemma-canonical-switch-'));
  let pyConnects = 0;
  let pyRestarts = 0;
  let jupyterRestarts = 0;
  let jupyterState = {
    path: 'analysis-jupyter.ipynb',
    cells: [] as Array<Record<string, unknown>>,
    variables: {} as Record<string, unknown>,
  };
  const pycharm: PyCharmAllHandlers = {
    ...handlers(),
    connect: async () => {
      pyConnects += 1;
      return text('connected to PyCharm notebook');
    },
    status: () => text('connected'),
    executeCell: async () => text('unused'),
    probe: async () => text('unused'),
    insertCell: () => text('inserted'),
    restartKernel: async () => {
      pyRestarts += 1;
      return text('restarted');
    },
    getState: () => text(JSON.stringify({
      uri: '/workspace/example/analysis-pycharm.ipynb',
      cells: [],
      variables: {},
    })),
  };
  const jupyter: JupyterlabHandlers = {
    ...handlers(),
    restartKernel: async () => {
      jupyterRestarts += 1;
      return text('restarted');
    },
    getState: () => text(JSON.stringify(jupyterState)),
    addAndRun: async ({ source }) => {
      jupyterState = {
        ...jupyterState,
        cells: [{ index: 0, executionCount: 1, error: null, source }],
        variables: { answer: { type: 'int', value: 42 } },
      };
      return text('cell 0 added+ran\n42');
    },
  };
  const store = new TaskStore('/workspace/example', base);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerCanonicalTools(server, {
    preferredSurface: 'pycharm',
    pycharm,
    jupyterlab: jupyter,
    connectJupyterlab: async () => text('connected to Jupyter notebook'),
    taskStore: store,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await client.callTool({ name: 'read', arguments: { kind: 'state' } });
    assert.equal(pyConnects, 1);

    const switchedResponse = await client.callTool({
      name: 'connect',
      arguments: { surface: 'jupyter' },
    });
    const switchedBlock = (switchedResponse as { content: Array<{ type: string; text?: string }> }).content[0];
    const switched = JSON.parse(switchedBlock.text ?? '{}');
    assert.equal(switched.status, 'connected');
    assert.equal(switched.surface, 'jupyter');
    assert.equal(switched.switched_from, 'pycharm');
    assert.equal(switched.kernel_reset, false);

    await client.callTool({
      name: 'run',
      arguments: { mode: 'append', source: 'answer = 42\nanswer' },
    });
    const ledger = store.requireActive();
    assert.deepEqual(ledger.notebooks.map((item) => item.surface), ['pycharm', 'jupyter']);
    assert.equal(ledger.notebook?.surface, 'jupyter');
    assert.equal(ledger.cells[0].surface, 'jupyter');
    assert.equal(pyRestarts, 0);
    assert.equal(jupyterRestarts, 0);
  } finally {
    await client.close();
    await server.close();
    rmSync(base, { recursive: true, force: true });
  }
});
