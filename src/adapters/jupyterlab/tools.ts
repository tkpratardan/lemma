// JupyterLab live-edit MCP tools. Without a server_url (or LEMMA_JUPYTER_URL),
// falls back to discoverNotebooks() for a local server.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  NotebookNotFound,
  ServerUnreachable,
  resolveConnection,
  discoverNotebooks,
} from './discovery.js';
import { JupyterLabSession } from './session.js';
import { notebookSummary, renderForAgent, pagedCellOutput, formatRunAll, truncate } from '../../utils/render.js';
import { formatCellDiff, mutationResult } from '../../utils/diff.js';
import { errorMessage } from '../../utils/errors.js';
import { text, jsonText } from '../../utils/response.js';
import type { NotebookHandlers } from '../notebook/tools.js';

let session: JupyterLabSession | undefined;

function requireSession(): JupyterLabSession | string {
  if (!session) {
    return (
      'not connected: call jupyterlab_connect first (or set LEMMA_JUPYTER_URL / ' +
      '_TOKEN / _NOTEBOOK)'
    );
  }
  return session;
}

// For process-exit cleanup: `JupyterLabSession.shutdown()` does no actual
// async work (`destroy()`/`dispose()` are synchronous Lumino/y-websocket calls
// under an async signature), so calling it unawaited from a synchronous exit
// handler is safe; nothing is lost mid-flight.
export function shutdownJupyterlabSession(): void {
  void session?.shutdown();
}

// The shared verb contract lives in adapters/notebook/tools.ts, which
// registers these once as notebook_* with a surface flag instead of twice.
export type JupyterlabHandlers = NotebookHandlers;

export function createJupyterlabHandlers(): JupyterlabHandlers {
  return {
    readNotebook() {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      return jsonText({ path: s.path, cells: notebookSummary(s.cells()) });
    },

    async getState() {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      const variables = await s.listVariables();
      const outline = s.cells().map((c, index) => ({
        index,
        cellType: c.cellType,
        source: truncate(c.source, 80, false),
        executionCount: c.executionCount,
        error: c.error,
      }));
      return jsonText({ path: s.path, variables, cells: outline });
    },

    async addAndRun({ source, index }) {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      const at = await s.addAndExecute(source, index);
      const cells = s.cells();
      const cell = cells[at];
      const out = cell ? renderForAgent(cell) : '[no output]';
      return text(`cell ${at} added+ran\n${out}`);
    },

    async runCell({ index }) {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      await s.executeCell(index);
      const cells = s.cells();
      const cell = cells[index];
      return text(cell ? renderForAgent(cell) : '[no output]');
    },

    readCellOutput({ index, offset }) {
      const s = requireSession();
      if (typeof s === 'string') return { content: [{ type: 'text' as const, text: s }] };
      return pagedCellOutput(s.cells()[index], index, offset);
    },

    async editAndRun({ index, source }) {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      s.editCell(index, source);
      await s.executeCell(index);
      const cell = s.cells()[index];
      return text(`cell ${index} edited+ran\n${cell ? renderForAgent(cell) : '[no output]'}`);
    },

    async runAllCells() {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      const cellTypes = s.cells().map((c) => c.cellType);
      const codeCells = cellTypes.filter((t) => t === 'code').length;
      const outputs: Array<{ index: number; output: string }> = [];
      let ran = 0;
      for (let i = 0; i < cellTypes.length; i++) {
        if (cellTypes[i] !== 'code') continue;
        await s.executeCell(i);
        const cell = s.cells()[i];
        ran += 1;
        outputs.push({ index: i, output: truncate(cell ? renderForAgent(cell) : '[no output]', 1500) });
        if (cell?.error) {
          return text(formatRunAll(ran, codeCells, i, outputs));
        }
      }
      return text(formatRunAll(ran, codeCells, undefined, outputs));
    },

    async inspectVariable({ name }) {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      return text(await s.inspectVariable(name));
    },

    editCell({ index, source }) {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      const cells = s.cells();
      const old = index >= 0 && index < cells.length ? cells[index].source : '';
      s.editCell(index, source);
      const diff = formatCellDiff(old, source, `cell ${index}`);
      return text(mutationResult(`edited cell ${index}`, diff));
    },

    insertCell({ index, source }) {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      const at = s.addCodeCell(source, index);
      const diff = formatCellDiff('', source, `new cell ${at}`);
      return text(mutationResult(`inserted cell at ${at}`, diff));
    },

    deleteCell({ index }) {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      const cells = s.cells();
      const removed = index >= 0 && index < cells.length ? cells[index].source : '';
      s.deleteCell(index);
      const diff = formatCellDiff(removed, '', `deleted cell ${index}`);
      return text(mutationResult(`deleted cell ${index}`, diff));
    },

    addMarkdown({ source, index }) {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      const at = s.addMarkdownCell(source, index);
      const diff = formatCellDiff('', source, `new markdown cell ${at}`);
      return text(mutationResult(`added markdown cell ${at}`, diff));
    },

    clearNotebook() {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      const cleared = s.clearNotebook();
      return text(cleared === 0 ? 'notebook already empty' : `cleared ${cleared} cell(s)`);
    },

    async restartKernel() {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      try {
        await s.restartKernel();
      } catch (e: unknown) {
        return text(`restart failed: ${errorMessage(e)}`);
      }
      return text('kernel restarted');
    },

    async saveNotebook() {
      const s = requireSession();
      if (typeof s === 'string') return text(s);
      await s.saveNotebook();
      return text('saved');
    },
  };
}

export interface JupyterlabConnectArgs {
  server_url?: string;
  token?: string;
  notebook_path?: string;
}

export async function connectJupyterlab({
  server_url,
  notebook_path,
  token,
}: JupyterlabConnectArgs): Promise<ReturnType<typeof text>> {
  let url = server_url || process.env.LEMMA_JUPYTER_URL || '';
  let tok = token || process.env.LEMMA_JUPYTER_TOKEN || '';
  let nbPath = notebook_path || process.env.LEMMA_JUPYTER_NOTEBOOK || '';
  if (!url) {
    const found = await discoverNotebooks();
    if (found.length === 1) {
      url = found[0].server.url;
      tok = found[0].server.token;
      nbPath = nbPath || found[0].notebookPath;
    } else if (found.length > 1) {
      return text(
        'found more than one local notebook, specify which:\n' +
          found.map((f) => `- ${f.notebookPath} on ${f.server.url}`).join('\n')
      );
    } else {
      return text('no local server found. Ask the user for the server URL (and token, if any).');
    }
  }
  let conn;
  try {
    conn = await resolveConnection(url, tok || undefined, nbPath || undefined);
  } catch (e) {
    if (e instanceof ServerUnreachable || e instanceof NotebookNotFound) {
      return text(e.message);
    }
    throw e;
  }
  if (conn.notebookPath === null) {
    return text(
      `connected to the server at ${conn.url}, but no notebook is open yet. Open a ` +
        '.ipynb in JupyterLab, then call connect again.'
    );
  }
  if (session) {
    try {
      await session.shutdown();
    } catch {
      /* best effort */
    }
    session = undefined;
  }
  try {
    session = await JupyterLabSession.connect(conn.url, conn.token, conn.notebookPath, {
      kernelName: conn.kernelName,
      sessionModel: conn.sessionModel,
    });
  } catch (e: unknown) {
    return text(`connection failed: ${errorMessage(e)}`);
  }
  const kernelNote = conn.kernelId ? 'shared kernel' : 'new kernel';
  return text(
    `connected to ${conn.notebookPath} on ${conn.url} (live RTC, ${kernelNote}): ` +
      `${session.cells().length} cells`
  );
}

// Registers jupyterlab_connect, the only verb with no pycharm equivalent;
// returns the shared handlers for adapters/notebook/tools.ts.
export function registerJupyterlabTools(server: McpServer): JupyterlabHandlers {
  const h = createJupyterlabHandlers();

  server.registerTool(
    'jupyterlab_connect',
    {
      description:
        'Connects to the notebook open in a running JupyterLab (RTC live-edit). Omit ' +
        'server_url to auto-discover a local server. Leave notebook_path empty for the ' +
        'most-recently-active notebook.',
      inputSchema: {
        server_url: z.string().optional().describe('Server URL; omit to auto-discover locally.'),
        token: z.string().optional().describe('Auth token; empty if none.'),
        notebook_path: z.string().optional().describe('Notebook path; empty for most-recently-active.'),
      },
    },
    ({ server_url, notebook_path, token }) =>
      connectJupyterlab({ server_url, notebook_path, token })
  );

  return h;
}
