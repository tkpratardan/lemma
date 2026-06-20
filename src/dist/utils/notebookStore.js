// .ipynb read/write. The v4 `.ipynb` format is documented JSON; the
// `Cell`/`Output` shape used here matches what diff/render already expect.
import * as fs from 'fs';
function sourceToStr(source) {
    if (Array.isArray(source)) {
        return source.join('');
    }
    return source ?? '';
}
// nbformat mimetype payloads can be a string or an array of lines (like
// `source`); renderForAgent expects a string, so normalize every mimetype.
function normalizeMimeData(data) {
    const normalized = {};
    for (const [mime, value] of Object.entries(data)) {
        normalized[mime] = Array.isArray(value) ? value.join('') : value;
    }
    return normalized;
}
function fromNbOutputs(rawOutputs) {
    const outputs = [];
    let error = null;
    for (const o of rawOutputs) {
        if (o.output_type === 'stream') {
            outputs.push({ kind: 'stream', data: { name: o.name ?? 'stdout', text: sourceToStr(o.text) } });
        }
        else if (o.output_type === 'execute_result' || o.output_type === 'display_data') {
            outputs.push({ kind: o.output_type, data: normalizeMimeData(o.data ?? {}) });
        }
        else if (o.output_type === 'error') {
            error = o.ename ?? null;
            outputs.push({
                kind: 'error',
                data: { traceback: o.traceback ?? [], ename: o.ename ?? '', evalue: o.evalue ?? '' },
            });
        }
    }
    return { outputs, error };
}
export function cellsFromNb(nb) {
    return nb.cells.map((rawCell) => {
        const source = sourceToStr(rawCell.source);
        const cellType = rawCell.cell_type ?? 'code';
        if (cellType === 'code') {
            const { outputs, error } = fromNbOutputs(rawCell.outputs ?? []);
            return {
                source,
                outputs,
                executionCount: rawCell.execution_count ?? null,
                error,
                cellType: 'code',
            };
        }
        return { source, outputs: [], executionCount: null, error: null, cellType };
    });
}
export function readNotebookFile(path) {
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    return cellsFromNb(raw);
}
// Split a string into nbformat's canonical multiline form: an array of lines,
// each retaining its trailing "\n" (matches Python's splitlines(keepends=True)
// and what Jupyter/PyCharm write). A trailing newline does not produce a final
// empty element. An empty string yields [].
function toMultiline(text) {
    if (!text)
        return [];
    const parts = text.split(/(?<=\n)/);
    if (parts.length > 0 && parts[parts.length - 1] === '')
        parts.pop();
    return parts;
}
export function toNbOutputs(cell) {
    return cell.outputs.map((o) => {
        if (o.kind === 'stream') {
            // nbformat's stream output is {output_type, name, text} only (no metadata),
            // and `text` must be the canonical multiline form: an array of lines, each
            // keeping its trailing newline. PyCharm's notebook editor errors on a plain
            // string here and refuses to render it (rich outputs use a different path
            // that tolerates a string, which is why they rendered and stream didn't).
            return { output_type: 'stream', name: o.data.name, text: toMultiline(o.data.text) };
        }
        if (o.kind === 'execute_result') {
            return {
                output_type: 'execute_result',
                execution_count: cell.executionCount,
                data: o.data,
                metadata: {},
            };
        }
        if (o.kind === 'display_data') {
            return { output_type: 'display_data', data: o.data, metadata: {} };
        }
        // error
        return {
            output_type: 'error',
            ename: o.data.ename,
            evalue: o.data.evalue,
            traceback: o.data.traceback,
        };
    });
}
export function buildNb(cells) {
    return {
        cells: cells.map((cell) => {
            if (cell.cellType === 'markdown' || cell.cellType === 'raw') {
                return { cell_type: cell.cellType, source: cell.source, metadata: {} };
            }
            return {
                cell_type: 'code',
                source: cell.source,
                execution_count: cell.executionCount,
                outputs: toNbOutputs(cell),
                metadata: {},
            };
        }),
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
    };
}
export function writeNotebookFile(path, cells) {
    fs.writeFileSync(path, JSON.stringify(buildNb(cells), null, 1));
}
//# sourceMappingURL=notebookStore.js.map