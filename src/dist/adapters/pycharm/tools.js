import { z } from 'zod';
import * as path from 'path';
import { DiskNotebook } from './disk.js';
import { formatCellDiff, mutationResult } from '../../utils/diff.js';
import { renderForAgent, notebookSummary, pagedCellOutput, formatRunAll, truncate } from '../../utils/render.js';
import { errorMessage } from '../../utils/errors.js';
import { text, jsonText } from '../../utils/response.js';
function createPyCharmHandlers(kernel) {
    // The .ipynb currently being driven. Set by pycharm_connect.
    let target;
    const NO_TARGET = 'No notebook connected. Call pycharm_connect(server_url, notebook_file) first. ' +
        'server_url is the Jupyter server PyCharm/DataSpell runs the kernel on (e.g. a ' +
        'docker-forwarded http://localhost:PORT); notebook_file is the absolute path to the ' +
        '.ipynb on disk that PyCharm has open.';
    function requireTarget() {
        if (!target)
            return NO_TARGET;
        if (!target.exists())
            return `notebook file not found on disk: ${target.path}`;
        return target;
    }
    function requireKernel() {
        return kernel.current();
    }
    return {
        async connect({ server_url, notebook_file, notebook_path, token }) {
            if (!path.isAbsolute(notebook_file)) {
                return text(`notebook_file must be an absolute path; got: ${notebook_file}`);
            }
            const nb = new DiskNotebook(notebook_file);
            if (!nb.exists()) {
                return text(`notebook file not found on disk: ${notebook_file}`);
            }
            try {
                const { kernelId } = await kernel.connect({
                    serverUrl: server_url,
                    token: token ?? '',
                    notebookPath: notebook_path,
                });
                target = nb;
                return text(`connected: kernel ${kernelId} on ${server_url}` +
                    (notebook_path ? ` (notebook ${notebook_path})` : ' (most-recently-active kernel)') +
                    `\nediting file: ${notebook_file} (${nb.cellCount()} cells)`);
            }
            catch (e) {
                return text(`pycharm_connect failed: ${errorMessage(e)}`);
            }
        },
        status() {
            if (!target)
                return text(NO_TARGET);
            const k = kernel.current();
            const kernelMsg = typeof k === 'string' ? `kernel: not connected (${k})` : 'kernel: connected';
            const fileMsg = target.exists()
                ? `file: ${target.path} (${target.cellCount()} cells)`
                : `file: MISSING on disk (${target.path})`;
            return text(`${fileMsg}\n${kernelMsg}`);
        },
        readNotebook() {
            const t = requireTarget();
            if (typeof t === 'string')
                return text(t);
            return jsonText({ uri: t.path, cells: notebookSummary(t.cells()) });
        },
        getState() {
            const t = requireTarget();
            if (typeof t === 'string')
                return text(t);
            const cells = notebookSummary(t.cells()).map((c) => ({ ...c, source: truncate(c.source, 80, false) }));
            return jsonText({ uri: t.path, cellCount: cells.length, cells });
        },
        readCellOutput({ index, offset }) {
            const t = requireTarget();
            if (typeof t === 'string')
                return { content: [{ type: 'text', text: t }] };
            return pagedCellOutput(t.cells()[index], index, offset);
        },
        async editAndRun({ index, source }) {
            const t = requireTarget();
            if (typeof t === 'string')
                return text(t);
            const k = requireKernel();
            if (typeof k === 'string')
                return text(k);
            t.edit(index, source);
            const cell = await k.execute(source);
            t.setOutputs(index, cell);
            return text(`cell ${index} edited+ran\n${renderForAgent(cell)}`);
        },
        async runAllCells() {
            const t = requireTarget();
            if (typeof t === 'string')
                return text(t);
            const k = requireKernel();
            if (typeof k === 'string')
                return text(k);
            const cells = t.cells();
            const codeCells = cells.filter((c) => c.cellType === 'code').length;
            const outputs = [];
            let ran = 0;
            for (let i = 0; i < cells.length; i++) {
                if (cells[i].cellType !== 'code')
                    continue;
                const cell = await k.execute(t.cellSource(i));
                t.setOutputs(i, cell);
                ran += 1;
                outputs.push({ index: i, output: truncate(renderForAgent(cell), 1500) });
                if (cell.error) {
                    return text(formatRunAll(ran, codeCells, i, outputs));
                }
            }
            return text(formatRunAll(ran, codeCells, undefined, outputs));
        },
        async addAndRun({ source, index }) {
            const t = requireTarget();
            if (typeof t === 'string')
                return text(t);
            const k = requireKernel();
            if (typeof k === 'string')
                return text(k);
            const at = index === undefined ? t.append(source) : t.insert(index, source);
            const cell = await k.execute(source);
            t.setOutputs(at, cell);
            return text(`cell ${at} added+ran\n${renderForAgent(cell)}`);
        },
        async executeCell({ code }) {
            const t = requireTarget();
            if (typeof t === 'string')
                return text(t);
            const k = requireKernel();
            if (typeof k === 'string')
                return text(k);
            const at = t.append(code);
            const cell = await k.execute(code);
            t.setOutputs(at, cell);
            return text(`cell ${at} added+ran\n${renderForAgent(cell)}`);
        },
        async runCell({ index }) {
            const t = requireTarget();
            if (typeof t === 'string')
                return text(t);
            const k = requireKernel();
            if (typeof k === 'string')
                return text(k);
            const source = t.cellSource(index);
            const cell = await k.execute(source);
            t.setOutputs(index, cell);
            return text(renderForAgent(cell));
        },
        async probe({ code }) {
            const k = requireKernel();
            if (typeof k === 'string')
                return text(k);
            const cell = await k.execute(code);
            return text(renderForAgent(cell));
        },
        async inspectVariable({ name }) {
            const k = requireKernel();
            if (typeof k === 'string')
                return text(k);
            const cell = await k.inspectVariable(name);
            return text(renderForAgent(cell));
        },
        editCell({ index, source }) {
            const t = requireTarget();
            if (typeof t === 'string')
                return text(t);
            const old = t.edit(index, source);
            return text(mutationResult(`edited cell ${index}`, formatCellDiff(old, source, `cell ${index}`)));
        },
        insertCell({ index, source }) {
            const t = requireTarget();
            if (typeof t === 'string')
                return text(t);
            const at = t.insert(index, source);
            return text(mutationResult(`inserted cell at ${at}`, formatCellDiff('', source, `new cell ${at}`)));
        },
        deleteCell({ index }) {
            const t = requireTarget();
            if (typeof t === 'string')
                return text(t);
            const removed = t.delete(index);
            return text(mutationResult(`deleted cell ${index}`, formatCellDiff(removed, '', `deleted cell ${index}`)));
        },
        addMarkdown({ source, index }) {
            const t = requireTarget();
            if (typeof t === 'string')
                return text(t);
            const at = index !== undefined ? t.insert(index, source, 'markdown') : t.append(source, 'markdown');
            return text(mutationResult(`added markdown cell ${at}`, formatCellDiff('', source, `new markdown cell ${at}`)));
        },
        clearNotebook() {
            const t = requireTarget();
            if (typeof t === 'string')
                return text(t);
            const n = t.clear();
            return text(n === 0 ? 'notebook already empty' : `cleared ${n} cell(s)`);
        },
        async restartKernel() {
            const k = requireKernel();
            if (typeof k === 'string')
                return text(k);
            const r = await k.restart();
            return text(r.message ?? 'restart requested');
        },
        saveNotebook() {
            const t = requireTarget();
            if (typeof t === 'string')
                return text(t);
            return text('already saved (edits write straight to disk)');
        },
    };
}
// Registers pycharm_connect/status plus the verbs with no jupyterlab
// equivalent; returns the shared handlers for adapters/notebook/tools.ts.
export function registerPyCharmTools(server, kernel) {
    const h = createPyCharmHandlers(kernel);
    server.registerTool('pycharm_connect', {
        description: 'Connect to a notebook open in PyCharm/DataSpell: attach its Jupyter kernel and ' +
            'target its .ipynb on disk. Only if open in PyCharm/DataSpell specifically — try ' +
            'vscode_status, then jupyterlab_connect, first.',
        inputSchema: {
            server_url: z.string().describe('Jupyter server base URL the kernel runs on, e.g. http://localhost:8888'),
            notebook_file: z.string().describe('Absolute path to the .ipynb on disk that PyCharm has open.'),
            notebook_path: z
                .string()
                .optional()
                .describe('Server-relative notebook path to pin the kernel to; omit for most-recently-active.'),
            token: z.string().optional().describe('Auth token; omit for token-less servers.'),
        },
    }, ({ server_url, notebook_file, notebook_path, token }) => h.connect({ server_url, notebook_file, notebook_path, token }));
    server.registerTool('pycharm_status', {
        description: 'PyCharm/DataSpell connection status. Try vscode_status, then jupyterlab_connect, ' +
            'first — only use PyCharm once those are ruled out.',
        inputSchema: {},
    }, () => h.status());
    server.registerTool('pycharm_execute_cell', {
        description: 'Append a code cell and run it. Alias of notebook_add_and_run (append).',
        inputSchema: { code: z.string().describe('Source for the new cell.') },
    }, ({ code }) => h.executeCell({ code }));
    server.registerTool('pycharm_probe', {
        description: 'Run code and return output without adding a cell. For environment probing only ' +
            '(os.getcwd(), versions) — a real result belongs in add_and_run.',
        inputSchema: { code: z.string().describe('Code to execute and discard.') },
    }, ({ code }) => h.probe({ code }));
    server.registerTool('pycharm_insert_cell', {
        description: 'Insert a code cell at a position without running it. Use notebook_add_and_run to add+run in one step.',
        inputSchema: {
            index: z.number().int().describe('0-based position to insert at.'),
            source: z.string().describe('Source for the new cell.'),
        },
    }, ({ index, source }) => h.insertCell({ index, source }));
    return h;
}
//# sourceMappingURL=tools.js.map