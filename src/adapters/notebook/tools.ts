// Verbs pycharm and jupyterlab implement identically, registered once as
// notebook_* with a `surface` flag instead of twice under separate prefixes.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { PyCharmHandlers } from '../pycharm/tools.js';
import type { JupyterlabHandlers } from '../jupyterlab/tools.js';
import { CELL_INDEX_DESC, INSERT_INDEX_DESC } from '../../utils/toolDocs.js';

export interface NotebookSurfaces {
  pycharm?: PyCharmHandlers;
  jupyterlab?: JupyterlabHandlers;
}

export function registerNotebookTools(server: McpServer, surfaces: NotebookSurfaces): void {
  const names = [surfaces.pycharm && 'pycharm', surfaces.jupyterlab && 'jupyterlab'].filter(
    (n): n is string => Boolean(n)
  );
  if (names.length === 0) {
    return;
  }
  const surfaceEnum = names as [string, ...string[]];
  const surfaceParam = z
    .enum(surfaceEnum)
    .describe(names.length > 1 ? 'Which surface: pycharm or jupyterlab.' : `Surface (only ${names[0]} is configured).`);

  function handlersFor(surface: string): PyCharmHandlers | JupyterlabHandlers {
    return surface === 'pycharm' ? surfaces.pycharm! : surfaces.jupyterlab!;
  }

  server.registerTool(
    'notebook_read',
    { description: "Notebook's full content: sources + outputs.", inputSchema: { surface: surfaceParam } },
    async ({ surface }) => handlersFor(surface).readNotebook()
  );

  server.registerTool(
    'notebook_get_state',
    {
      description: 'Token-light notebook outline (kernel variables too, on jupyterlab).',
      inputSchema: { surface: surfaceParam },
    },
    async ({ surface }) => handlersFor(surface).getState()
  );

  server.registerTool(
    'notebook_add_and_run',
    {
      description: 'Add + run a code cell in one call. Prefer over insert+run for new cells.',
      inputSchema: {
        surface: surfaceParam,
        source: z.string().describe('Source for the new cell.'),
        index: z.number().int().optional().describe(`${INSERT_INDEX_DESC} pycharm only; jupyterlab always appends.`),
      },
    },
    async ({ surface, source, index }) => handlersFor(surface).addAndRun({ source, index })
  );

  server.registerTool(
    'notebook_run_cell',
    {
      description: 'Run an existing cell by index.',
      inputSchema: { surface: surfaceParam, index: z.number().int().describe(CELL_INDEX_DESC) },
    },
    async ({ surface, index }) => handlersFor(surface).runCell({ index })
  );

  server.registerTool(
    'notebook_read_cell_output',
    {
      description:
        "Cell's full stored output: text paged via `offset` (4000 chars/call) + plot images. " +
        'Use when truncated output or an "[image output …]" placeholder isn\'t enough. Does not ' +
        're-run.',
      inputSchema: {
        surface: surfaceParam,
        index: z.number().int().describe(CELL_INDEX_DESC),
        offset: z.number().int().min(0).optional().describe('Character offset to page text output from.'),
      },
    },
    async ({ surface, index, offset }) => handlersFor(surface).readCellOutput({ index, offset })
  );

  server.registerTool(
    'notebook_edit_and_run',
    {
      description:
        "Replace a cell's source and run it in one call. Prefer over edit+run for immediate " +
        'execution.',
      inputSchema: {
        surface: surfaceParam,
        index: z.number().int().describe(CELL_INDEX_DESC),
        source: z.string().describe('New source for the cell.'),
      },
    },
    async ({ surface, index, source }) => handlersFor(surface).editAndRun({ index, source })
  );

  server.registerTool(
    'notebook_run_all_cells',
    {
      description:
        'Run all code cells top to bottom, stop at first error. Use after a kernel restart or ' +
        'to verify end-to-end.',
      inputSchema: { surface: surfaceParam },
    },
    async ({ surface }) => handlersFor(surface).runAllCells()
  );

  server.registerTool(
    'notebook_inspect_variable',
    {
      description: 'Richer preview of one variable in the kernel.',
      inputSchema: {
        surface: surfaceParam,
        name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a plain identifier'),
      },
    },
    async ({ surface, name }) => handlersFor(surface).inspectVariable({ name })
  );

  server.registerTool(
    'notebook_edit_cell',
    {
      description: "Replace a cell's source. Does not run it.",
      inputSchema: {
        surface: surfaceParam,
        index: z.number().int().describe(CELL_INDEX_DESC),
        source: z.string().describe('New source for the cell.'),
      },
    },
    async ({ surface, index, source }) => handlersFor(surface).editCell({ index, source })
  );

  server.registerTool(
    'notebook_delete_cell',
    {
      description: 'Delete a cell by index.',
      inputSchema: { surface: surfaceParam, index: z.number().int().describe(CELL_INDEX_DESC) },
    },
    async ({ surface, index }) => handlersFor(surface).deleteCell({ index })
  );

  server.registerTool(
    'notebook_add_markdown',
    {
      description: 'Insert a markdown cell; omit index to append.',
      inputSchema: {
        surface: surfaceParam,
        source: z.string().describe('Markdown source for the new cell.'),
        index: z.number().int().optional().describe(INSERT_INDEX_DESC),
      },
    },
    async ({ surface, source, index }) => handlersFor(surface).addMarkdown({ source, index })
  );

  server.registerTool(
    'notebook_clear_notebook',
    {
      description: 'Delete all cells. Irreversible: only when the user explicitly asks to clear/reset.',
      inputSchema: { surface: surfaceParam },
    },
    async ({ surface }) => handlersFor(surface).clearNotebook()
  );

  server.registerTool(
    'notebook_restart_kernel',
    {
      description: 'Restart the kernel, clearing all runtime state.',
      inputSchema: { surface: surfaceParam },
    },
    async ({ surface }) => handlersFor(surface).restartKernel()
  );

  server.registerTool(
    'notebook_save_notebook',
    {
      description: 'Save the notebook (no-op on pycharm — it writes to disk on every edit).',
      inputSchema: { surface: surfaceParam },
    },
    async ({ surface }) => handlersFor(surface).saveNotebook()
  );
}
