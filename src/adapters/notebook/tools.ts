// Verbs pycharm and jupyterlab implement identically, registered once as
// notebook_* with a `surface` flag instead of twice under separate prefixes.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CELL_INDEX_DESC, INSERT_INDEX_DESC } from '../../utils/toolDocs.js';
import { text } from '../../utils/response.js';
import type { pagedCellOutput } from '../../utils/render.js';

export type TextResult = ReturnType<typeof text>;
export type NotebookResult = TextResult | ReturnType<typeof pagedCellOutput>;
// pycharm implements getState/saveNotebook synchronously where jupyterlab
// awaits; the union lets both surfaces satisfy one contract.
export type MaybePromise<T> = T | Promise<T>;

// The verb contract both surfaces implement identically (pycharm/tools.ts,
// jupyterlab/tools.ts), registered once below as notebook_* with a `surface`
// flag instead of twice under separate prefixes.
export interface NotebookHandlers {
  readNotebook(): MaybePromise<TextResult>;
  getState(): MaybePromise<TextResult>;
  addAndRun(args: { source: string; index?: number }): Promise<TextResult>;
  runCell(args: { index: number }): Promise<TextResult>;
  readCellOutput(args: { index: number; offset?: number }): MaybePromise<NotebookResult>;
  editAndRun(args: { index: number; source: string }): Promise<TextResult>;
  runAllCells(): Promise<TextResult>;
  inspectVariable(args: { name: string }): Promise<TextResult>;
  editCell(args: { index: number; source: string }): MaybePromise<TextResult>;
  insertCell(args: { index: number; source: string }): MaybePromise<TextResult>;
  deleteCell(args: { index: number }): MaybePromise<TextResult>;
  addMarkdown(args: { source: string; index?: number }): MaybePromise<TextResult>;
  clearNotebook(): MaybePromise<TextResult>;
  restartKernel(): Promise<TextResult>;
  saveNotebook(): MaybePromise<TextResult>;
}

export interface NotebookSurfaces {
  pycharm?: NotebookHandlers;
  jupyterlab?: NotebookHandlers;
}

export function cleanRunSummary(body: string): string {
  const [headline, ...details] = body.split('\n');
  const failed = headline.includes('stopped at cell');
  const failureDetail = failed ? `\n${details.join('\n').slice(0, 2000)}` : '';
  return `clean-kernel verification: ${failed ? 'FAILED' : 'PASSED'} — ${headline}${failureDetail}`;
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

  function handlersFor(surface: string): NotebookHandlers {
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
        "Full stored output for one cell: text paged via `offset`, plus images. Use past a " +
        'truncated or placeholder output. Does not re-run.',
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
      description: "Replaces and runs a cell's source in one call. Prefer over edit+run.",
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
      description: 'Runs all cells top to bottom, stops at the first error. For post-restart or end-to-end checks.',
      inputSchema: { surface: surfaceParam },
    },
    async ({ surface }) => handlersFor(surface).runAllCells()
  );

  server.registerTool(
    'notebook_verify_clean_run',
    {
      description:
        'Decision-grade reproducibility check: save, restart the kernel, and run all cells top to bottom. ' +
        'Returns a compact pass/fail summary instead of every cell output. Clears current runtime state.',
      inputSchema: {
        surface: surfaceParam,
        confirm: z.literal(true).describe('Confirm that clearing current kernel state is intended.'),
      },
    },
    async ({ surface }) => {
      const handlers = handlersFor(surface);
      await handlers.saveNotebook();
      await handlers.restartKernel();
      const result = await handlers.runAllCells();
      const body = result.content.find((block) => block.type === 'text')?.text ?? 'no verification result';
      return text(cleanRunSummary(body));
    }
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
      description: 'Deletes all cells. Irreversible, only on an explicit clear/reset request.',
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
      description: 'Saves the notebook. No-op on pycharm, it writes to disk on every edit.',
      inputSchema: { surface: surfaceParam },
    },
    async ({ surface }) => handlersFor(surface).saveNotebook()
  );
}
