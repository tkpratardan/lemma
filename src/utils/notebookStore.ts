// .ipynb read/write. The v4 `.ipynb` format is documented JSON; the
// `Cell`/`Output` shape used here matches what diff/render already expect.
import * as fs from 'fs';
import type { Cell, CellOutput } from './render.js';

export interface RawOutput {
  output_type: string;
  name?: string;
  text?: string | string[];
  data?: Record<string, unknown>;
  execution_count?: number | null;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  metadata?: Record<string, unknown>;
}
interface RawCell {
  cell_type: string;
  source: string | string[];
  execution_count?: number | null;
  outputs?: RawOutput[];
  metadata?: Record<string, unknown>;
}

interface RawNotebook {
  cells: RawCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

function sourceToStr(source: string | string[] | undefined): string {
  if (Array.isArray(source)) {
    return source.join('');
  }
  return source ?? '';
}

// nbformat mimetype payloads can be a string or an array of lines (like
// `source`); renderForAgent expects a string, so normalize every mimetype.
function normalizeMimeData(data: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [mime, value] of Object.entries(data)) {
    normalized[mime] = Array.isArray(value) ? value.join('') : value;
  }
  return normalized;
}

function fromNbOutputs(rawOutputs: RawOutput[]): { outputs: CellOutput[]; error: string | null } {
  const outputs: CellOutput[] = [];
  let error: string | null = null;
  for (const o of rawOutputs) {
    if (o.output_type === 'stream') {
      outputs.push({ kind: 'stream', data: { name: o.name ?? 'stdout', text: sourceToStr(o.text) } });
    } else if (o.output_type === 'execute_result' || o.output_type === 'display_data') {
      outputs.push({ kind: o.output_type, data: normalizeMimeData(o.data ?? {}) });
    } else if (o.output_type === 'error') {
      error = o.ename ?? null;
      outputs.push({
        kind: 'error',
        data: { traceback: o.traceback ?? [], ename: o.ename ?? '', evalue: o.evalue ?? '' },
      });
    }
  }
  return { outputs, error };
}

export function cellsFromNb(nb: RawNotebook): Cell[] {
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

// Split a string into nbformat's canonical multiline form: an array of lines,
// each retaining its trailing "\n" (matches Python's splitlines(keepends=True)
// and what Jupyter/PyCharm write). A trailing newline does not produce a final
// empty element. An empty string yields [].
function toMultiline(text: string | undefined): string[] {
  if (!text) return [];
  const parts = text.split(/(?<=\n)/);
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

export function toNbOutputs(cell: Cell): RawOutput[] {
  return cell.outputs.map((o): RawOutput => {
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
