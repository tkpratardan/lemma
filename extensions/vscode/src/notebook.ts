// Core native-notebook operations for the active VS Code editor. Drives the
// IDE directly so cells run natively: the user sees the spinner and output
// appears below the cell.
import * as vscode from 'vscode';
import { stripAnsi, truncate, compactTraceback } from '../../../src/utils/render.js';

const MAX_TEXT = 4000;
const READ_OUTPUT_MAX = 2000;

export interface CellSummary {
  index: number;
  kind: 'code' | 'markdown';
  source: string;
  executionCount?: number;
  output?: string;
}

// Source of the cells immediately before/after `index` ('' if out of range).
// Used to give the confirm-edit diff view surrounding context instead of an
// isolated single cell.
export function neighborContext(nb: vscode.NotebookDocument, index: number): { prev: string; next: string } {
  return {
    prev: index > 0 ? nb.cellAt(index - 1).document.getText() : '',
    next: index < nb.cellCount - 1 ? nb.cellAt(index + 1).document.getText() : '',
  };
}

// preserveFocus: bring the notebook into view without stealing keyboard focus.
export async function revealCell(nb: vscode.NotebookDocument, index: number): Promise<void> {
  if (nb.cellCount === 0) return;
  const at = Math.max(0, Math.min(index, nb.cellCount - 1));
  await vscode.window.showNotebookDocument(nb, {
    selections: [new vscode.NotebookRange(at, at + 1)],
    preserveFocus: true,
  });
}


// A cell's stored text output at full fidelity (ANSI-stripped, untruncated).
export function cellOutputText(cell: vscode.NotebookCell): string {
  const parts: string[] = [];
  for (const out of cell.outputs) {
    for (const item of out.items) {
      if (item.mime === 'application/vnd.code.notebook.error') {
        try {
          const err = JSON.parse(new TextDecoder().decode(item.data));
          parts.push(`${err.name}: ${err.message}\n${(err.stack || '')}`);
        } catch {
          parts.push(new TextDecoder().decode(item.data));
        }
      } else if (
        item.mime === 'application/vnd.code.notebook.stdout' ||
        item.mime === 'application/vnd.code.notebook.stderr' ||
        item.mime.startsWith('text/') ||
        item.mime.includes('json')
      ) {
        parts.push(new TextDecoder().decode(item.data));
      }
    }
  }
  return stripAnsi(parts.filter(Boolean).join('\n').trim());
}

// Decode a cell's outputs into compact, token-safe text (never raw base64).
export function renderOutputs(cell: vscode.NotebookCell, limit = MAX_TEXT): string {
  let body = truncate(compactTraceback(cellOutputText(cell)), limit);
  const hasImage = cell.outputs.some((out) => out.items.some((item) => item.mime.startsWith('image/')));
  if (hasImage) {
    body = (body ? body + '\n' : '') + '[image output — vscode_read_cell_output returns it as a viewable image]';
  }
  return body || '[no output]';
}

export interface CellImage {
  mime: string;
  base64: string;
}

// Raster image outputs of a cell, base64-encoded. SVG is excluded: MCP image
// content blocks take raster mimes only, and plots rasterize by default.
export function cellImages(cell: vscode.NotebookCell): CellImage[] {
  const images: CellImage[] = [];
  for (const out of cell.outputs) {
    for (const item of out.items) {
      if (item.mime.startsWith('image/') && item.mime !== 'image/svg+xml') {
        images.push({ mime: item.mime, base64: Buffer.from(item.data).toString('base64') });
      }
    }
  }
  return images;
}

export function readNotebook(nb: vscode.NotebookDocument): CellSummary[] {
  return nb.getCells().map((cell) => ({
    index: cell.index,
    kind: cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown',
    source: cell.document.getText(),
    executionCount: cell.executionSummary?.executionOrder,
    output: cell.kind === vscode.NotebookCellKind.Code ? renderOutputs(cell, READ_OUTPUT_MAX) : undefined,
  }));
}

// The kernel language of the active notebook (e.g. 'python', 'r'), used when
// constructing new code cells so they bind to the right kernel. Falls back to
// 'python' when no language metadata is present.
export function notebookLanguage(nb: vscode.NotebookDocument): string {
  for (const cell of nb.getCells()) {
    if (cell.kind === vscode.NotebookCellKind.Code) {
      return cell.document.languageId || 'python';
    }
  }
  return 'python';
}

// Insert a cell at `index` (code or markdown) and return that index. The edit
// appears live in the editor. `index` clamps to [0, cellCount].
export async function insertCell(
  nb: vscode.NotebookDocument,
  index: number,
  source: string,
  kind: vscode.NotebookCellKind = vscode.NotebookCellKind.Code
): Promise<number> {
  const at = Math.max(0, Math.min(index, nb.cellCount));
  const lang = kind === vscode.NotebookCellKind.Code ? notebookLanguage(nb) : 'markdown';
  const data = new vscode.NotebookCellData(kind, source, lang);
  const edit = new vscode.WorkspaceEdit();
  edit.set(nb.uri, [vscode.NotebookEdit.insertCells(at, [data])]);
  await vscode.workspace.applyEdit(edit);
  return at;
}

export async function appendCell(
  nb: vscode.NotebookDocument,
  source: string,
  kind: vscode.NotebookCellKind = vscode.NotebookCellKind.Code
): Promise<number> {
  return insertCell(nb, nb.cellCount, source, kind);
}

export async function deleteCell(nb: vscode.NotebookDocument, index: number): Promise<void> {
  if (index < 0 || index >= nb.cellCount) {
    throw new Error(`cell index ${index} out of range (0..${nb.cellCount - 1})`);
  }
  const edit = new vscode.WorkspaceEdit();
  edit.set(nb.uri, [vscode.NotebookEdit.deleteCells(new vscode.NotebookRange(index, index + 1))]);
  await vscode.workspace.applyEdit(edit);
}

export async function clearNotebook(nb: vscode.NotebookDocument): Promise<number> {
  const count = nb.cellCount;
  if (count === 0) return 0;
  const edit = new vscode.WorkspaceEdit();
  edit.set(nb.uri, [vscode.NotebookEdit.deleteCells(new vscode.NotebookRange(0, count))]);
  await vscode.workspace.applyEdit(edit);
  return count;
}

export async function editCell(nb: vscode.NotebookDocument, index: number, source: string): Promise<void> {
  const cell = nb.cellAt(index);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(cell.document.uri, new vscode.Range(0, 0, cell.document.lineCount, 0), source);
  await vscode.workspace.applyEdit(edit);
}

// A token-light outline of the notebook: per-cell kind, source, execution
// count, but no outputs. The IDE counterpart of get_notebook_state's cell list.
export function notebookOutline(nb: vscode.NotebookDocument): object {
  return {
    uri: nb.uri.fsPath,
    language: notebookLanguage(nb),
    cellCount: nb.cellCount,
    cells: nb.getCells().map((cell) => ({
      index: cell.index,
      kind: cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown',
      source: truncate(cell.document.getText(), 80, false),
      executionCount: cell.executionSummary?.executionOrder,
    })),
  };
}

// Language-appropriate one-variable introspection snippet. `name` must already
// be validated as a bare identifier by the caller.
function inspectSnippet(language: string, name: string): string {
  if (language === 'r') {
    return `cat(paste(class(${name}), collapse=","), "\\n"); print(${name})`;
  }
  return (
    `import pprint as _pp\n` +
    `print(type(${name}).__name__)\n` +
    `try:\n    print('shape', ${name}.shape)\nexcept Exception:\n    pass\n` +
    `_pp.pprint(${name})`
  );
}

// Inspect a single variable by running a transient introspection cell natively,
// capturing its output, then removing the cell so the notebook stays clean.
export async function inspectVariable(nb: vscode.NotebookDocument, name: string): Promise<string> {
  const snippet = inspectSnippet(notebookLanguage(nb), name);
  const index = await appendCell(nb, snippet);
  try {
    return await executeCell(nb, index);
  } finally {
    await deleteCell(nb, index);
  }
}

// Restart the kernel of the active notebook. VS Code has no single stable
// command id across versions, so we try the known ones in order.
export async function restartKernel(nb: vscode.NotebookDocument): Promise<string> {
  const candidates = ['jupyter.restartkernel', 'notebook.restartKernel'];
  for (const cmd of candidates) {
    try {
      await vscode.commands.executeCommand(cmd, { notebookUri: nb.uri });
      return `kernel restarted (${cmd})`;
    } catch {
      // try the next candidate
    }
  }
  throw new Error('could not restart kernel (no known restart command available)');
}

// Save the notebook's in-memory document to disk, via VS Code's own save
// API (not an external file write): so the on-disk .ipynb picks up the
// session's edits with no "file changed on disk" conflict risk. Always
// attempts the save rather than gating on nb.isDirty first — that flag has
// been observed stuck false with real unsaved edits pending, which silently
// no-ops every save call and risks losing a whole session's work.
export async function saveNotebook(nb: vscode.NotebookDocument): Promise<boolean> {
  const saved = await vscode.workspace.save(nb.uri);
  return saved !== undefined;
}

export async function openNotebook(path: string): Promise<vscode.NotebookDocument> {
  const doc = await vscode.workspace.openNotebookDocument(vscode.Uri.file(path));
  await vscode.window.showNotebookDocument(doc);
  return doc;
}

// Read an .ipynb from disk (cells + saved outputs) without making it active.
export async function readNotebookFile(path: string): Promise<CellSummary[]> {
  const doc = await vscode.workspace.openNotebookDocument(vscode.Uri.file(path));
  return readNotebook(doc);
}

// Execute a cell natively and wait until VS Code reports it finished, then read
// its outputs. We listen to notebook change events for the cell's execution
// summary rather than assuming the command resolves on completion.
export async function executeCell(nb: vscode.NotebookDocument, index: number, timeoutMs = 120000): Promise<string> {
  const done = waitForExecution(nb, index, timeoutMs);
  await vscode.commands.executeCommand('notebook.cell.execute', {
    ranges: [{ start: index, end: index + 1 }],
    document: nb.uri,
  });
  await done;
  return renderOutputs(nb.cellAt(index));
}

export interface RunAllResult {
  ran: number;
  codeCells: number;
  failedAt?: number;
  outputs: Array<{ index: number; output: string }>;
}

function hasErrorOutput(cell: vscode.NotebookCell): boolean {
  return cell.outputs.some((out) =>
    out.items.some((item) => item.mime === 'application/vnd.code.notebook.error')
  );
}

// Run every code cell top to bottom, stopping at the first error — Jupyter's
// Run All semantics, so later cells never execute against a broken state.
// Sequential (not the notebook.execute command) so completion is observable
// per cell and the failing cell is identifiable. Per-cell outputs are capped
// harder than single-cell runs: a long notebook would otherwise flood the
// caller.
export async function runAllCells(nb: vscode.NotebookDocument, perCellTimeoutMs = 120000): Promise<RunAllResult> {
  const outputs: Array<{ index: number; output: string }> = [];
  let ran = 0;
  const codeCells = nb.getCells().filter((c) => c.kind === vscode.NotebookCellKind.Code).length;
  for (let i = 0; i < nb.cellCount; i++) {
    const cell = nb.cellAt(i);
    if (cell.kind !== vscode.NotebookCellKind.Code) {
      continue;
    }
    const output = await executeCell(nb, i, perCellTimeoutMs);
    ran += 1;
    outputs.push({ index: i, output: truncate(output, 1500) });
    if (hasErrorOutput(cell)) {
      await revealCell(nb, i);
      return { ran, codeCells, failedAt: i, outputs };
    }
  }
  return { ran, codeCells, outputs };
}

function waitForExecution(nb: vscode.NotebookDocument, index: number, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const startOrder = nb.cellAt(index).executionSummary?.executionOrder;
    const timer = setTimeout(() => {
      sub.dispose();
      resolve();
    }, timeoutMs);
    const sub = vscode.workspace.onDidChangeNotebookDocument((e) => {
      if (e.notebook.uri.toString() !== nb.uri.toString()) {
        return;
      }
      for (const change of e.cellChanges) {
        if (change.cell.index !== index) {
          continue;
        }
        const summary = change.cell.executionSummary;
        // Finished when a (new) execution order is assigned and timing ended.
        if (summary && summary.executionOrder !== startOrder && summary.timing?.endTime) {
          clearTimeout(timer);
          sub.dispose();
          resolve();
        }
      }
    });
  });
}
