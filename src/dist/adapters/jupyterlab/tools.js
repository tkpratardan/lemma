import { z } from 'zod';
import { NotebookNotFound, ServerUnreachable, resolveConnection, } from './discovery.js';
import { JupyterLabSession } from './session.js';
import { notebookSummary, renderForAgent, pagedCellOutput, formatRunAll, truncate } from '../../utils/render.js';
import { formatCellDiff, mutationResult } from '../../utils/diff.js';
import { errorMessage } from '../../utils/errors.js';
import { text, jsonText } from '../../utils/response.js';
let session;
function requireSession() {
    if (!session) {
        return ('not connected: call jupyterlab_connect first (or set LEMMA_JUPYTER_URL / ' +
            '_TOKEN / _NOTEBOOK)');
    }
    return session;
}
// For process-exit cleanup: `JupyterLabSession.shutdown()` does no actual
// async work (`destroy()`/`dispose()` are synchronous Lumino/y-websocket calls
// under an async signature), so calling it unawaited from a synchronous exit
// handler is safe; nothing is lost mid-flight.
export function shutdownJupyterlabSession() {
    void session?.shutdown();
}
function createJupyterlabHandlers() {
    return {
        readNotebook() {
            const s = requireSession();
            if (typeof s === 'string')
                return text(s);
            return jsonText({ path: s.path, cells: notebookSummary(s.cells()) });
        },
        async getState() {
            const s = requireSession();
            if (typeof s === 'string')
                return text(s);
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
        async addAndRun({ source }) {
            const s = requireSession();
            if (typeof s === 'string')
                return text(s);
            const index = await s.addAndExecute(source);
            const cells = s.cells();
            const cell = cells[index];
            const out = cell ? renderForAgent(cell) : '[no output]';
            return text(`cell ${index} added+ran\n${out}`);
        },
        async runCell({ index }) {
            const s = requireSession();
            if (typeof s === 'string')
                return text(s);
            await s.executeCell(index);
            const cells = s.cells();
            const cell = cells[index];
            return text(cell ? renderForAgent(cell) : '[no output]');
        },
        readCellOutput({ index, offset }) {
            const s = requireSession();
            if (typeof s === 'string')
                return { content: [{ type: 'text', text: s }] };
            return pagedCellOutput(s.cells()[index], index, offset);
        },
        async editAndRun({ index, source }) {
            const s = requireSession();
            if (typeof s === 'string')
                return text(s);
            s.editCell(index, source);
            await s.executeCell(index);
            const cell = s.cells()[index];
            return text(`cell ${index} edited+ran\n${cell ? renderForAgent(cell) : '[no output]'}`);
        },
        async runAllCells() {
            const s = requireSession();
            if (typeof s === 'string')
                return text(s);
            const cellTypes = s.cells().map((c) => c.cellType);
            const codeCells = cellTypes.filter((t) => t === 'code').length;
            const outputs = [];
            let ran = 0;
            for (let i = 0; i < cellTypes.length; i++) {
                if (cellTypes[i] !== 'code')
                    continue;
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
            if (typeof s === 'string')
                return text(s);
            return text(await s.inspectVariable(name));
        },
        editCell({ index, source }) {
            const s = requireSession();
            if (typeof s === 'string')
                return text(s);
            const cells = s.cells();
            const old = index >= 0 && index < cells.length ? cells[index].source : '';
            s.editCell(index, source);
            const diff = formatCellDiff(old, source, `cell ${index}`);
            return text(mutationResult(`edited cell ${index}`, diff));
        },
        deleteCell({ index }) {
            const s = requireSession();
            if (typeof s === 'string')
                return text(s);
            const cells = s.cells();
            const removed = index >= 0 && index < cells.length ? cells[index].source : '';
            s.deleteCell(index);
            const diff = formatCellDiff(removed, '', `deleted cell ${index}`);
            return text(mutationResult(`deleted cell ${index}`, diff));
        },
        addMarkdown({ source, index }) {
            const s = requireSession();
            if (typeof s === 'string')
                return text(s);
            const at = s.addMarkdownCell(source, index);
            const diff = formatCellDiff('', source, `new markdown cell ${at}`);
            return text(mutationResult(`added markdown cell ${at}`, diff));
        },
        clearNotebook() {
            const s = requireSession();
            if (typeof s === 'string')
                return text(s);
            const cleared = s.clearNotebook();
            return text(cleared === 0 ? 'notebook already empty' : `cleared ${cleared} cell(s)`);
        },
        async restartKernel() {
            const s = requireSession();
            if (typeof s === 'string')
                return text(s);
            try {
                await s.restartKernel();
            }
            catch (e) {
                return text(`restart failed: ${errorMessage(e)}`);
            }
            return text('kernel restarted');
        },
        async saveNotebook() {
            const s = requireSession();
            if (typeof s === 'string')
                return text(s);
            await s.saveNotebook();
            return text('saved');
        },
    };
}
// Registers jupyterlab_connect, the only verb with no pycharm equivalent;
// returns the shared handlers for adapters/notebook/tools.ts.
export function registerJupyterlabTools(server) {
    const h = createJupyterlabHandlers();
    server.registerTool('jupyterlab_connect', {
        description: 'Connect to the notebook open in a running JupyterLab (RTC live-edit). Lemma does not ' +
            'discover the server itself — find one first (`jupyter server list` or ask the user), ' +
            'then pass server_url (a full pasted URL with ?token= works) and token. Leave ' +
            'notebook_path empty for the most-recently-active notebook.',
        inputSchema: {
            server_url: z.string().optional().describe('Server URL; required unless LEMMA_JUPYTER_URL is set.'),
            token: z.string().optional().describe('Server auth token; empty for a token-less server.'),
            notebook_path: z
                .string()
                .optional()
                .describe('Notebook path; empty for the most-recently-active notebook.'),
        },
    }, async ({ server_url, notebook_path, token }) => {
        const url = server_url || process.env.LEMMA_JUPYTER_URL || '';
        const tok = token || process.env.LEMMA_JUPYTER_TOKEN || '';
        const nbPath = notebook_path || process.env.LEMMA_JUPYTER_NOTEBOOK || '';
        if (!url) {
            return text('no server_url given (and LEMMA_JUPYTER_URL is not set). Lemma does not discover ' +
                'a running Jupyter server itself: find one yourself first (e.g. `jupyter server ' +
                'list`), then pass its URL (and token, if any) explicitly.');
        }
        let conn;
        try {
            conn = await resolveConnection(url, tok || undefined, nbPath || undefined);
        }
        catch (e) {
            if (e instanceof ServerUnreachable || e instanceof NotebookNotFound) {
                return text(e.message);
            }
            throw e;
        }
        if (conn.notebookPath === null) {
            return text(`connected to the server at ${conn.url}, but no notebook is open yet. Open a ` +
                '.ipynb in JupyterLab, then call jupyterlab_connect again.');
        }
        if (session) {
            try {
                await session.shutdown();
            }
            catch {
                /* best effort */
            }
            session = undefined;
        }
        try {
            session = await JupyterLabSession.connect(conn.url, conn.token, conn.notebookPath, {
                kernelName: conn.kernelName,
                sessionModel: conn.sessionModel,
            });
        }
        catch (e) {
            return text(`connection failed: ${errorMessage(e)}`);
        }
        const kernelNote = conn.kernelId ? 'shared kernel' : 'new kernel';
        return text(`connected to ${conn.notebookPath} on ${conn.url} (live RTC, ${kernelNote}): ` +
            `${session.cells().length} cells`);
    });
    return h;
}
//# sourceMappingURL=tools.js.map