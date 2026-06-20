// Disk-backed notebook editor for the PyCharm / DataSpell path: PyCharm
// reliably reloads an open .ipynb when it changes on disk, so every mutation
// reads the latest file, edits the raw nbformat JSON in place (preserving
// notebook-level metadata/kernelspec/nbformat), and writes it back — reading
// fresh each time avoids clobbering a cell the user just added by hand.
// TODO: concurrent edits (user typing while a mutation lands) can still race.
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { cellsFromNb, toNbOutputs } from '../../utils/notebookStore.js';
function srcToStr(source) {
    return Array.isArray(source) ? source.join('') : (source ?? '');
}
export class DiskNotebook {
    path;
    constructor(path) {
        this.path = path;
    }
    read() {
        const nb = JSON.parse(fs.readFileSync(this.path, 'utf8'));
        if (!Array.isArray(nb.cells))
            nb.cells = [];
        return nb;
    }
    // Match writeNotebookFile's on-disk style (indent 1) so diffs against a
    // file PyCharm last wrote stay small.
    write(nb) {
        fs.writeFileSync(this.path, JSON.stringify(nb, null, 1));
    }
    newCell(source, cellType) {
        // nbformat 4.5 requires a unique cell id; PyCharm/JupyterLab track cells (and
        // their rendered outputs) across reloads by it, so a cell without one gets its
        // state reset on reload. 8 hex chars matches what Jupyter itself generates.
        const cell = {
            cell_type: cellType,
            id: randomUUID().replace(/-/g, '').slice(0, 8),
            source,
            metadata: {},
        };
        if (cellType === 'code') {
            cell.outputs = [];
            cell.execution_count = null;
        }
        return cell;
    }
    exists() {
        try {
            fs.accessSync(this.path);
            return true;
        }
        catch {
            return false;
        }
    }
    cellCount() {
        return this.read().cells.length;
    }
    summary() {
        return this.read().cells.map((c, i) => ({
            index: i,
            kind: c.cell_type === 'code' ? 'code' : 'markdown',
            source: srcToStr(c.source),
            executionCount: c.execution_count ?? null,
        }));
    }
    // Cells with parsed outputs (incl. images) for notebook_read/get_state/
    // read_cell_output — summary() above only covers the older bare outline.
    cells() {
        const nb = this.read();
        return cellsFromNb({ ...nb, metadata: nb.metadata ?? {}, nbformat: nb.nbformat ?? 4, nbformat_minor: nb.nbformat_minor ?? 5 });
    }
    cellSource(index) {
        const nb = this.read();
        const c = nb.cells[index];
        if (!c)
            throw new Error(`no cell at index ${index} (notebook has ${nb.cells.length})`);
        return srcToStr(c.source);
    }
    append(source, cellType = 'code') {
        const nb = this.read();
        nb.cells.push(this.newCell(source, cellType));
        this.write(nb);
        return nb.cells.length - 1;
    }
    insert(index, source, cellType = 'code') {
        const nb = this.read();
        const at = Math.max(0, Math.min(index, nb.cells.length));
        nb.cells.splice(at, 0, this.newCell(source, cellType));
        this.write(nb);
        return at;
    }
    // Returns previous source for diffing.
    edit(index, source) {
        const nb = this.read();
        const c = nb.cells[index];
        if (!c)
            throw new Error(`no cell at index ${index} (notebook has ${nb.cells.length})`);
        const old = srcToStr(c.source);
        c.source = source;
        this.write(nb);
        return old;
    }
    delete(index) {
        const nb = this.read();
        const c = nb.cells[index];
        if (!c)
            throw new Error(`no cell at index ${index} (notebook has ${nb.cells.length})`);
        const removed = srcToStr(c.source);
        nb.cells.splice(index, 1);
        this.write(nb);
        return removed;
    }
    clear() {
        const nb = this.read();
        const count = nb.cells.length;
        nb.cells = [];
        this.write(nb);
        return count;
    }
    // Write a kernel execution result into a code cell's outputs + execution_count.
    setOutputs(index, cell) {
        const nb = this.read();
        const c = nb.cells[index];
        if (!c)
            throw new Error(`no cell at index ${index} (notebook has ${nb.cells.length})`);
        c.outputs = toNbOutputs(cell);
        c.execution_count = cell.executionCount ?? null;
        this.write(nb);
    }
}
//# sourceMappingURL=disk.js.map