// Disk-backed notebook editor for the PyCharm / DataSpell path: PyCharm
// reliably reloads an open .ipynb when it changes on disk, so every mutation
// reads the latest file, edits the raw nbformat JSON in place (preserving
// notebook-level metadata/kernelspec/nbformat), and writes it back — reading
// fresh each time avoids clobbering a cell the user just added by hand.
// TODO: concurrent edits (user typing while a mutation lands) can still race.
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { cellsFromNb, toNbOutputs, type RawOutput } from '../../utils/notebookStore.js';
import type { Cell } from '../../utils/render.js';

interface RawCell {
  cell_type: string;
  id?: string;
  source: string | string[];
  execution_count?: number | null;
  outputs?: RawOutput[];
  metadata?: Record<string, unknown>;
}

interface RawNotebook {
  cells: RawCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
}

function srcToStr(source: string | string[] | undefined): string {
  return Array.isArray(source) ? source.join('') : (source ?? '');
}

export interface CellSummary {
  index: number;
  kind: 'code' | 'markdown';
  source: string;
  executionCount: number | null;
}

export class DiskNotebook {
  constructor(readonly path: string) {}

  private read(): RawNotebook {
    const nb = JSON.parse(fs.readFileSync(this.path, 'utf8')) as RawNotebook;
    if (!Array.isArray(nb.cells)) nb.cells = [];
    return nb;
  }

  // Match writeNotebookFile's on-disk style (indent 1) so diffs against a
  // file PyCharm last wrote stay small.
  private write(nb: RawNotebook): void {
    fs.writeFileSync(this.path, JSON.stringify(nb, null, 1));
  }

  private newCell(source: string, cellType: 'code' | 'markdown'): RawCell {
    // nbformat 4.5 requires a unique cell id; PyCharm/JupyterLab track cells (and
    // their rendered outputs) across reloads by it, so a cell without one gets its
    // state reset on reload. 8 hex chars matches what Jupyter itself generates.
    const cell: RawCell = {
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

  exists(): boolean {
    try {
      fs.accessSync(this.path);
      return true;
    } catch {
      return false;
    }
  }

  cellCount(): number {
    return this.read().cells.length;
  }

  summary(): CellSummary[] {
    return this.read().cells.map((c, i) => ({
      index: i,
      kind: c.cell_type === 'code' ? 'code' : 'markdown',
      source: srcToStr(c.source),
      executionCount: c.execution_count ?? null,
    }));
  }

  // Cells with parsed outputs (incl. images) for notebook_read/get_state/
  // read_cell_output — summary() above only covers the older bare outline.
  cells(): Cell[] {
    const nb = this.read();
    return cellsFromNb({ ...nb, metadata: nb.metadata ?? {}, nbformat: nb.nbformat ?? 4, nbformat_minor: nb.nbformat_minor ?? 5 });
  }

  cellSource(index: number): string {
    const nb = this.read();
    const c = nb.cells[index];
    if (!c) throw new Error(`no cell at index ${index} (notebook has ${nb.cells.length})`);
    return srcToStr(c.source);
  }

  append(source: string, cellType: 'code' | 'markdown' = 'code'): number {
    const nb = this.read();
    nb.cells.push(this.newCell(source, cellType));
    this.write(nb);
    return nb.cells.length - 1;
  }

  insert(index: number, source: string, cellType: 'code' | 'markdown' = 'code'): number {
    const nb = this.read();
    const at = Math.max(0, Math.min(index, nb.cells.length));
    nb.cells.splice(at, 0, this.newCell(source, cellType));
    this.write(nb);
    return at;
  }

  // Returns previous source for diffing.
  edit(index: number, source: string): string {
    const nb = this.read();
    const c = nb.cells[index];
    if (!c) throw new Error(`no cell at index ${index} (notebook has ${nb.cells.length})`);
    const old = srcToStr(c.source);
    c.source = source;
    this.write(nb);
    return old;
  }

  delete(index: number): string {
    const nb = this.read();
    const c = nb.cells[index];
    if (!c) throw new Error(`no cell at index ${index} (notebook has ${nb.cells.length})`);
    const removed = srcToStr(c.source);
    nb.cells.splice(index, 1);
    this.write(nb);
    return removed;
  }

  clear(): number {
    const nb = this.read();
    const count = nb.cells.length;
    nb.cells = [];
    this.write(nb);
    return count;
  }

  // Write a kernel execution result into a code cell's outputs + execution_count.
  setOutputs(index: number, cell: Cell): void {
    const nb = this.read();
    const c = nb.cells[index];
    if (!c) throw new Error(`no cell at index ${index} (notebook has ${nb.cells.length})`);
    c.outputs = toNbOutputs(cell);
    c.execution_count = cell.executionCount ?? null;
    this.write(nb);
  }
}
