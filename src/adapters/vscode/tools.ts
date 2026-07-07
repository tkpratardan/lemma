// VS Code / Cursor editor MCP tools. Drives the notebook open in the user's
// editor via the Lemma extension's bridge: edits go through
// `vscode.NotebookEdit`, live, with no .ipynb disk write, so there's no
// "file changed on disk" conflict. For a JupyterLab tab use the
// `jupyterlab_*` tools instead.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Editor, findEditor } from './editor.js';
import { text, jsonText, imageBlock } from '../../utils/response.js';
import { CELL_INDEX_DESC, INSERT_INDEX_DESC } from '../../utils/toolDocs.js';

// Short by design: AGENTS.md's own rule says what a discard means, and the
// PreToolUse hook (where installed) mechanically blocks a retry either way.
const DISCARDED = 'discarded';

// ~3 MB decoded; a plot past this is almost certainly an unbounded-DPI
// accident, and it would swamp the model's context either way.
const MAX_IMAGE_B64 = 4_000_000;

const OUTPUT_CHUNK = 4000;

const NO_EDITOR =
  'no VS Code / Cursor editor bridge found. Open VS Code / Cursor with the Lemma extension ' +
  'installed, then retry. (For a JupyterLab tab use jupyterlab_*; for a PyCharm/DataSpell ' +
  'notebook use pycharm_*.)';

const PATH_DESC =
  "Path to the .ipynb, absolute or workspace-relative. Auto-opens if needed; name the exact " +
  "notebook, don't guess.";

async function requireEditor(): Promise<Editor | string> {
  const ed = await findEditor();
  if (!ed) return NO_EDITOR;
  return ed;
}

export function registerVscodeTools(server: McpServer): void {
  server.registerTool(
    'vscode_status',
    {
      description: 'Check the editor bridge is reachable; list open notebooks.',
      inputSchema: {},
    },
    async () => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const o = await ed.open();
      return text(o.notebooks.length > 0 ? o.notebooks.join('\n') : 'no notebooks open');
    }
  );

  server.registerTool(
    'vscode_read_notebook',
    {
      description: "Notebook's full content: sources + outputs.",
      inputSchema: { path: z.string().describe(PATH_DESC) },
    },
    async ({ path }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      return jsonText(await ed.read(path));
    }
  );

  server.registerTool(
    'vscode_get_state',
    {
      description: 'Token-light notebook outline (no outputs).',
      inputSchema: { path: z.string().describe(PATH_DESC) },
    },
    async ({ path }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      return jsonText(await ed.state(path));
    }
  );

  server.registerTool(
    'vscode_execute_cell',
    {
      description: 'Append a code cell and run it.',
      inputSchema: {
        path: z.string().describe(PATH_DESC),
        code: z.string().describe('Source for the new cell.'),
      },
    },
    async ({ path, code }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.execute(path, code);
      if (r.discarded) return text(DISCARDED);
      return text(`cell ${r.index} added+ran\n${r.output}`);
    }
  );

  server.registerTool(
    'vscode_probe',
    {
      // Implemented as create+execute+delete under the hood: nothing
      // persists in the notebook either way.
      description:
        'Runs code, returns output, no cell added. Environment checks only (paths, versions); ' +
        'real results go in add_and_run.',
      inputSchema: {
        path: z.string().describe(PATH_DESC),
        code: z.string().describe('Code to execute and discard.'),
      },
    },
    async ({ path, code }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.probe(path, code);
      return text(r.output ?? '[no output]');
    }
  );

  server.registerTool(
    'vscode_add_and_run',
    {
      description: 'Add + run a code cell in one call. Prefer over insert+run for new cells.',
      inputSchema: {
        path: z.string().describe(PATH_DESC),
        source: z.string().describe('Source for the new cell.'),
        index: z.number().int().optional().describe(INSERT_INDEX_DESC),
      },
    },
    async ({ path, source, index }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.addAndRun(path, source, index);
      if (r.discarded) return text(DISCARDED);
      return text(`cell ${r.index} added+ran\n${r.output ?? '[no output]'}`);
    }
  );

  server.registerTool(
    'vscode_run_cell',
    {
      description: 'Run an existing cell by index.',
      inputSchema: {
        path: z.string().describe(PATH_DESC),
        index: z.number().int().describe(CELL_INDEX_DESC),
      },
    },
    async ({ path, index }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.run(path, index);
      return text(r.output ?? '[no output]');
    }
  );

  server.registerTool(
    'vscode_read_cell_output',
    {
      description:
        "Full stored output for one cell: text paged via `offset`, plus images. Use past a " +
        'truncated or placeholder output. Does not re-run.',
      inputSchema: {
        path: z.string().describe(PATH_DESC),
        index: z.number().int().describe(CELL_INDEX_DESC),
        offset: z.number().int().min(0).optional().describe('Character offset to page text output from.'),
      },
    },
    async ({ path, index, offset }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.output(path, index);
      if (!r.text && r.images.length === 0) {
        return text(`cell ${index} has no stored output (has it been run?)`);
      }
      const start = offset ?? 0;
      const chunk = r.text.slice(start, start + OUTPUT_CHUNK);
      const end = start + chunk.length;
      let header = `cell ${index} output (${r.text.length} chars total${start > 0 ? `, from ${start}` : ''})`;
      if (end < r.text.length) {
        header += ` — ${r.text.length - end} more; call again with offset=${end}`;
      }
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text' as const, text: chunk ? `${header}\n${chunk}` : header },
      ];
      if (start === 0) {
        for (const img of r.images) {
          if (img.base64.length > MAX_IMAGE_B64) {
            content.push({
              type: 'text' as const,
              text: `[skipped one ${img.mime} output: too large to attach — lower the figure DPI/size and re-run]`,
            });
          } else {
            content.push(imageBlock(img.base64, img.mime));
          }
        }
      }
      return { content };
    }
  );

  server.registerTool(
    'vscode_run_all_cells',
    {
      description: 'Runs all cells top to bottom, stops at the first error. For post-restart or end-to-end checks.',
      inputSchema: { path: z.string().describe(PATH_DESC) },
    },
    async ({ path }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.runAll(path);
      const stopped = r.failedAt !== undefined ? `; stopped at cell ${r.failedAt} (error)` : '';
      const body = r.outputs
        .filter((o) => o.output && o.output !== '[no output]')
        .map((o) => `--- cell ${o.index} ---\n${o.output}`)
        .join('\n');
      return text(`ran ${r.ran}/${r.codeCells} code cells${stopped}\n${body}`);
    }
  );

  server.registerTool(
    'vscode_edit_cell',
    {
      description: "Replace a cell's source. Does not run it.",
      inputSchema: {
        path: z.string().describe(PATH_DESC),
        index: z.number().int().describe(CELL_INDEX_DESC),
        source: z.string().describe('New source for the cell.'),
      },
    },
    async ({ path, index, source }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.edit(path, index, source);
      if (r.discarded) return text(DISCARDED);
      if (r.diff === '(no change)') return text(`cell ${index} unchanged`);
      return text(`cell ${index} edited`);
    }
  );

  server.registerTool(
    'vscode_edit_and_run',
    {
      description: "Replaces and runs a cell's source in one call. Prefer over edit+run.",
      inputSchema: {
        path: z.string().describe(PATH_DESC),
        index: z.number().int().describe(CELL_INDEX_DESC),
        source: z.string().describe('New source for the cell.'),
      },
    },
    async ({ path, index, source }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.editAndRun(path, index, source);
      if (r.discarded) return text(DISCARDED);
      return text(`cell ${index} edited+ran\n${r.output ?? '[no output]'}`);
    }
  );

  server.registerTool(
    'vscode_insert_cell',
    {
      description: "Inserts a code cell, doesn't run it. See vscode_add_and_run to add+execute together.",
      inputSchema: {
        path: z.string().describe(PATH_DESC),
        index: z.number().int().describe('0-based position to insert at.'),
        source: z.string().describe('Source for the new cell.'),
      },
    },
    async ({ path, index, source }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.insert(path, index, source);
      if (r.discarded) return text(DISCARDED);
      return text(`cell ${r.index} inserted`);
    }
  );

  server.registerTool(
    'vscode_delete_cell',
    {
      description: 'Delete a cell by index.',
      inputSchema: {
        path: z.string().describe(PATH_DESC),
        index: z.number().int().describe(CELL_INDEX_DESC),
      },
    },
    async ({ path, index }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.delete(path, index);
      if (r.discarded) return text(DISCARDED);
      return text(`cell ${index} deleted`);
    }
  );

  server.registerTool(
    'vscode_add_markdown',
    {
      description: 'Insert a markdown cell; omit index to append.',
      inputSchema: {
        path: z.string().describe(PATH_DESC),
        source: z.string().describe('Markdown source for the new cell.'),
        index: z.number().int().optional().describe(INSERT_INDEX_DESC),
      },
    },
    async ({ path, source, index }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.markdown(path, source, index);
      if (r.discarded) return text(DISCARDED);
      return text(`markdown cell ${r.index} added`);
    }
  );

  server.registerTool(
    'vscode_restart_kernel',
    {
      description: 'Restart the kernel, clearing all runtime state.',
      inputSchema: { path: z.string().describe(PATH_DESC) },
    },
    async ({ path }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.restart(path);
      return text(r.message ?? 'restart requested');
    }
  );

  server.registerTool(
    'vscode_inspect_variable',
    {
      description: 'Richer preview of one variable in the kernel.',
      inputSchema: {
        path: z.string().describe(PATH_DESC),
        name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'must be a plain identifier'),
      },
    },
    async ({ path, name }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.inspect(path, name);
      return text(r.output ?? '[no output]');
    }
  );

  server.registerTool(
    'vscode_clear_notebook',
    {
      description: 'Deletes all cells. Irreversible, only on an explicit clear/reset request.',
      inputSchema: { path: z.string().describe(PATH_DESC) },
    },
    async ({ path }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.clear(path);
      return text(r.cleared === 0 ? 'notebook already empty' : `cleared ${r.cleared} cell(s)`);
    }
  );

  server.registerTool(
    'vscode_save_notebook',
    {
      // Other vscode_* edits land live in the editor but aren't written to
      // the .ipynb on disk until this is called. Uses VS Code's own save API
      // (not an external file write), so there's no disk-conflict risk.
      description: 'Save in-memory edits to disk.',
      inputSchema: { path: z.string().describe(PATH_DESC) },
    },
    async ({ path }) => {
      const ed = await requireEditor();
      if (typeof ed === 'string') return text(ed);
      const r = await ed.save(path);
      return text(r.saved ? 'saved' : 'nothing to save');
    }
  );
}
