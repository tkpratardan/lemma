import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import type {
  NotebookHandlers,
  NotebookResult,
  TextResult,
} from '../adapters/notebook/tools.js';
import { cleanRunSummary } from '../adapters/notebook/tools.js';
import type { PyCharmAllHandlers } from '../adapters/pycharm/tools.js';
import {
  connectJupyterlab,
  type JupyterlabHandlers,
} from '../adapters/jupyterlab/tools.js';
import { Editor, findEditor } from '../adapters/vscode/editor.js';
import { errorMessage } from '../utils/errors.js';
import { imageBlock, jsonText, text } from '../utils/response.js';
import { truncate } from '../utils/render.js';
import {
  sourceInspectionCode,
  type SourceInspectionRequest,
  type SourceInspectionSingleRequest,
} from './sourceInspection.js';
import type { Surface } from './surface.js';
import {
  TaskGateError,
  TaskStore,
  type ArtifactReference,
  type Assumption,
  type OpenRisk,
  type SourceReference,
  type TaskLedger,
  type ValidatedFact,
} from './taskState.js';

interface ConnectArgs {
  surface?: Surface;
  server_url?: string;
  token?: string;
  notebook_path?: string;
  notebook_file?: string;
}

interface SurfaceAdapter extends NotebookHandlers {
  surface: Surface;
  connect(args: ConnectArgs): Promise<TextResult>;
}

export interface CanonicalDependencies {
  /** Preferred only for lazy attachment; explicit connect may select any available surface. */
  preferredSurface?: Surface;
  pycharm?: PyCharmAllHandlers;
  jupyterlab?: JupyterlabHandlers;
  connectJupyterlab?: typeof connectJupyterlab;
  taskStore?: TaskStore;
  findVscodeEditor?: typeof findEditor;
  includeAuditTools?: boolean;
}

interface StateCell {
  index?: number;
  executionCount?: number | null;
  error?: string | null;
  source?: string;
}

interface StateSnapshot {
  path?: string;
  uri?: string;
  variables?: Record<string, unknown>;
  cells?: StateCell[];
}

type StoredOutputContent = 'text' | 'images' | 'all' | 'metadata';
type ExecutionOutput = 'summary' | 'images' | 'full' | 'none';
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

const resultShapeSchema = z.enum(['scalar', 'list', 'table', 'narrative', 'report', 'artifact']);
const expectedOutputSchema = z.object({
  shape: resultShapeSchema,
  description: z.string().max(500).optional(),
  unit: z.string().max(100).optional(),
});
const taskBeginSchema = z.object({
  goal: z.string().min(1).max(1000).optional(),
  expected_output: expectedOutputSchema.optional(),
  task_id: z.string().max(100).optional(),
});

function resultText(result: NotebookResult): string {
  const parts: string[] = [];
  for (const block of result.content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('\n');
}

function storedOutputResponse(
  result: NotebookResult,
  content: StoredOutputContent,
  imageIndex?: number
): NotebookResult {
  const blocks = result.content as ContentBlock[];
  const textBlocks = blocks.filter(
    (block): block is { type: 'text'; text: string } => block.type === 'text'
  );
  const imageBlocks = blocks.filter(
    (block): block is { type: 'image'; data: string; mimeType: string } => block.type === 'image'
  );
  if (imageIndex !== undefined && imageIndex >= imageBlocks.length) {
    throw new TaskGateError(
      `image_index=${imageIndex} is out of range; this cell has ${imageBlocks.length} readable image output(s).`
    );
  }

  const selectedImages = imageIndex === undefined
    ? content === 'images'
      ? imageBlocks.slice(0, 1)
      : imageBlocks
    : [imageBlocks[imageIndex]];
  const metadata = {
    image_count: imageBlocks.length,
    images: imageBlocks.map((block, index) => ({
      index,
      mime_type: block.mimeType,
      encoded_chars: block.data.length,
    })),
    returned_images: content === 'images' || content === 'all' ? selectedImages.length : 0,
    remaining_images:
      content === 'images' && imageIndex === undefined
        ? Math.max(0, imageBlocks.length - selectedImages.length)
        : 0,
  };

  if (content === 'metadata') return jsonText(metadata);
  if (content === 'text') {
    const hint = imageBlocks.length
      ? `image outputs: ${imageBlocks.length}; call read(kind="output", content="images", index=..., image_index=0) to view one.`
      : 'image outputs: 0';
    return { content: [...textBlocks, { type: 'text', text: hint }] };
  }

  const metadataBlock: ContentBlock = { type: 'text', text: JSON.stringify(metadata) };
  return {
    content:
      content === 'images'
        ? [metadataBlock, ...selectedImages]
        : [...textBlocks, metadataBlock, ...selectedImages],
  };
}

function parseState(result: NotebookResult): StateSnapshot {
  try {
    return JSON.parse(resultText(result)) as StateSnapshot;
  } catch {
    return {};
  }
}

function selectedCell(state: StateSnapshot, index?: number): StateCell | undefined {
  if (index === undefined) return undefined;
  return state.cells?.find((cell, position) => (cell.index ?? position) === index);
}

function inferCellIndex(body: string, state: StateSnapshot, requested?: number): number | undefined {
  if (requested !== undefined) return requested;
  const matched = body.match(/\bcell\s+(\d+)\b/i);
  if (matched) return Number(matched[1]);
  if (state.cells?.length) return state.cells.length - 1;
  return undefined;
}

export function changedVariables(
  before: Record<string, unknown> = {},
  after: Record<string, unknown> = {}
): { added: string[]; updated: string[]; removed: string[] } {
  const beforeNames = new Set(Object.keys(before));
  const afterNames = new Set(Object.keys(after));
  return {
    added: [...afterNames].filter((name) => !beforeNames.has(name)).sort(),
    updated: [...afterNames]
      .filter((name) => beforeNames.has(name) && JSON.stringify(before[name]) !== JSON.stringify(after[name]))
      .sort(),
    removed: [...beforeNames].filter((name) => !afterNames.has(name)).sort(),
  };
}

function warningsFrom(body: string): string[] {
  return body
    .split('\n')
    .filter((line) => /\bwarning\b/i.test(line))
    .slice(0, 5)
    .map((line) => truncate(line.trim(), 300, false));
}

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function detectedArtifacts(source: string | undefined, cellId: string | number): ArtifactReference[] {
  if (!source) return [];
  const artifacts: ArtifactReference[] = [];
  const patterns = [
    /\.(?:to_csv|to_parquet|to_feather|to_excel|to_json|savefig|write_text|write_bytes)\(\s*(?:[rubf]{0,2})?(['"])([^'"]+)\1/gi,
    /\b(?:joblib\.)?dump\([^,]+,\s*(?:[rubf]{0,2})?(['"])([^'"]+)\1/gi,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const candidate = match[2];
      if (!candidate || /[{}]/.test(candidate)) continue;
      const absolute = path.resolve(candidate);
      try {
        if (!fs.statSync(absolute).isFile()) continue;
      } catch {
        continue;
      }
      artifacts.push({ uri: absolute, description: `Created by executed cell ${String(cellId)}` });
    }
  }
  return artifacts;
}

function connectionSucceeded(result: NotebookResult): boolean {
  return /^connected\b/i.test(resultText(result).trim());
}

function operationFailed(result: NotebookResult): boolean {
  return /^(no\s|not connected|.*\bfailed\b|.*\bnot found\b)/i.test(resultText(result).trim());
}

function sourceObservation(body: string): Record<string, unknown> | undefined {
  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) continue;
    try {
      return JSON.parse(lines[index]) as Record<string, unknown>;
    } catch {
      // Notebook adapters may prepend execution text; keep looking for the output line.
    }
  }
  return undefined;
}

function compactSourceValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return truncate(value, 120, false);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 2) return truncate(JSON.stringify(value), 160, false);
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => compactSourceValue(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 12)
      .map(([key, item]) => [key, compactSourceValue(item, depth + 1)])
  );
}

function compactSourceItem(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const item = value as Record<string, unknown>;
  if (item.view === 'inventory') {
    return {
      view: item.view,
      source_count: item.source_count,
      returned: item.returned,
      truncated: item.truncated,
      sources: Array.isArray(item.sources) ? item.sources.slice(0, 12) : item.sources,
    };
  }
  const base = {
    view: item.view,
    path: item.path,
    error: item.error,
    rows: item.rows,
    columns: item.columns,
    returned_columns: item.returned_columns,
    truncated_columns: item.truncated_columns,
    header_row: item.header_row,
    encoding: item.encoding,
    sheets: item.sheets,
    selected_sheet: item.selected_sheet,
    header_candidates: Array.isArray(item.header_candidates)
      ? item.header_candidates.slice(0, 2).map((record) => compactSourceValue(record))
      : undefined,
  };
  if (item.view === 'schema') {
    return {
      ...base,
      raw_preview: Array.isArray(item.raw_preview)
        ? item.raw_preview.slice(0, 4).map((record) => compactSourceValue(record))
        : compactSourceValue(item.raw_preview),
      schema: Array.isArray(item.schema)
        ? item.schema.slice(0, 50).map((record) => compactSourceValue(record))
        : compactSourceValue(item.schema),
    };
  }
  if (item.view === 'head') {
    return {
      ...base,
      records: Array.isArray(item.records)
        ? item.records.slice(0, 4).map((record) => compactSourceValue(record))
        : compactSourceValue(item.records),
    };
  }
  return {
    ...base,
    profile: Array.isArray(item.profile)
      ? item.profile.slice(0, 12).map((record) => compactSourceValue(record))
      : compactSourceValue(item.profile),
  };
}

function compactSourceObservation(body: string): unknown | undefined {
  const observation = sourceObservation(body);
  if (!observation) return undefined;
  return observation.view === 'batch' && Array.isArray(observation.observations)
    ? { view: 'batch', observations: observation.observations.map(compactSourceItem) }
    : compactSourceItem(observation);
}

function taskSummary(ledger: TaskLedger) {
  return {
    id: ledger.taskId,
    status: ledger.status,
    goal: truncate(ledger.goal, 180, false),
    ...(ledger.expectedOutput ? { expected_output: ledger.expectedOutput } : {}),
    revision: ledger.mutationRevision,
    executions: ledger.executionCount,
    counts: {
      facts: ledger.facts.length,
      assumptions: ledger.assumptions.length,
      artifacts: ledger.artifacts.length,
      risks: ledger.risks.length,
      sources: ledger.sources.length,
      cells: ledger.cells.length,
      observations: ledger.observations.length,
      notebooks: ledger.notebooks.length,
      errors: ledger.unresolvedErrors.length,
    },
    ...(ledger.notebook ? { notebook: ledger.notebook } : {}),
  };
}

type LedgerSection = 'summary' | 'facts' | 'assumptions' | 'artifacts' | 'risks' | 'sources' | 'errors';

function taskSection(ledger: TaskLedger, section: LedgerSection, offset: number, limit: number) {
  if (section === 'summary') return { task: taskSummary(ledger) };
  const items = section === 'facts'
    ? ledger.facts
    : section === 'assumptions'
      ? ledger.assumptions
      : section === 'artifacts'
        ? ledger.artifacts
        : section === 'risks'
          ? ledger.risks
          : section === 'sources'
            ? ledger.sources
            : ledger.unresolvedErrors;
  const page = items.slice(offset, offset + limit);
  return {
    task: { id: ledger.taskId, status: ledger.status },
    section,
    items: page,
    total: items.length,
    ...(offset + page.length < items.length ? { next_offset: offset + page.length } : {}),
  };
}

function createVscodeAdapter(editorFinder: typeof findEditor): SurfaceAdapter {
  let editor: Editor | undefined;
  let targetPath: string | undefined;

  function requireConnection(): { editor: Editor; path: string } | string {
    if (!editor || !targetPath) return 'not connected: call connect for the VS Code surface first.';
    return { editor, path: targetPath };
  }

  return {
    surface: 'vscode',
    async connect({ notebook_path, notebook_file }) {
      const found = await editorFinder();
      if (!found) return text('no VS Code / Cursor editor bridge found. Open the editor and Lemma extension first.');
      const open = await found.open();
      const requested = notebook_path ?? notebook_file;
      if (!requested && open.notebooks.length !== 1) {
        return text(
          open.notebooks.length === 0
            ? 'no notebook is open in the editor; open one or pass notebook_path.'
            : `more than one notebook is open; pass notebook_path exactly:\n${open.notebooks.join('\n')}`
        );
      }
      targetPath = requested ?? open.notebooks[0];
      editor = found;
      await editor.state(targetPath);
      return text(`connected to ${targetPath} through the VS Code editor bridge`);
    },
    async readNotebook() {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      return jsonText(await current.editor.read(current.path));
    },
    async getState() {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      return jsonText(await current.editor.state(current.path));
    },
    async addAndRun({ source, index }) {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      const result = await current.editor.addAndRun(current.path, source, index);
      if (result.discarded) return text('discarded');
      return text(`cell ${result.index} added+ran\n${result.output ?? '[no output]'}`);
    },
    async runCell({ index }) {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      const result = await current.editor.run(current.path, index);
      return text(result.output ?? '[no output]');
    },
    async readCellOutput({ index, offset }) {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      const output = await current.editor.output(current.path, index);
      const start = offset ?? 0;
      const chunk = output.text.slice(start, start + 4000);
      const end = start + chunk.length;
      let header = `cell ${index} output (${output.text.length} chars total)`;
      if (end < output.text.length) header += ` — call read again with offset=${end}`;
      const content: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
      > = [
        { type: 'text', text: chunk ? `${header}\n${chunk}` : header },
      ];
      if (start === 0) {
        for (const image of output.images) {
          if (image.base64.length <= 4_000_000) content.push(imageBlock(image.base64, image.mime));
        }
      }
      return { content };
    },
    async editAndRun({ index, source }) {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      const result = await current.editor.editAndRun(current.path, index, source);
      if (result.discarded) return text('discarded');
      return text(`cell ${index} edited+ran\n${result.output ?? '[no output]'}`);
    },
    async runAllCells() {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      const result = await current.editor.runAll(current.path);
      const stopped = result.failedAt === undefined ? '' : `; stopped at cell ${result.failedAt} (error)`;
      const outputs = result.outputs
        .filter((item) => item.output && item.output !== '[no output]')
        .map((item) => `--- cell ${item.index} ---\n${item.output}`)
        .join('\n');
      return text(`ran ${result.ran}/${result.codeCells} code cells${stopped}\n${outputs}`);
    },
    async inspectVariable({ name }) {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      const result = await current.editor.inspect(current.path, name);
      return text(result.output ?? '[no output]');
    },
    async editCell({ index, source }) {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      const result = await current.editor.edit(current.path, index, source);
      return text(result.discarded ? 'discarded' : `cell ${index} edited`);
    },
    async insertCell({ index, source }) {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      const result = await current.editor.insert(current.path, index, source);
      return text(result.discarded ? 'discarded' : `cell ${result.index} inserted`);
    },
    async deleteCell({ index }) {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      const result = await current.editor.delete(current.path, index);
      return text(result.discarded ? 'discarded' : `cell ${index} deleted`);
    },
    async addMarkdown({ source, index }) {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      const result = await current.editor.markdown(current.path, source, index);
      return text(result.discarded ? 'discarded' : `markdown cell ${result.index} added`);
    },
    async clearNotebook() {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      const result = await current.editor.clear(current.path);
      return text(`cleared ${result.cleared} cell(s)`);
    },
    async restartKernel() {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      const result = await current.editor.restart(current.path);
      return text(result.message ?? 'kernel restarted');
    },
    async saveNotebook() {
      const current = requireConnection();
      if (typeof current === 'string') return text(current);
      await current.editor.save(current.path);
      return text('saved');
    },
  };
}

function createAdapters(dependencies: CanonicalDependencies): Map<Surface, SurfaceAdapter> {
  const adapters = new Map<Surface, SurfaceAdapter>();
  adapters.set('vscode', createVscodeAdapter(dependencies.findVscodeEditor ?? findEditor));
  if (dependencies.pycharm) {
    adapters.set('pycharm', {
      ...dependencies.pycharm,
      surface: 'pycharm',
      connect: (args) =>
        dependencies.pycharm!.connect({
          server_url: args.server_url ?? process.env.LEMMA_PYCHARM_URL ?? '',
          notebook_file: args.notebook_file ?? process.env.LEMMA_PYCHARM_NOTEBOOK_FILE ?? '',
          notebook_path: args.notebook_path ?? process.env.LEMMA_PYCHARM_NOTEBOOK,
          token: args.token ?? process.env.LEMMA_PYCHARM_TOKEN,
        }),
    });
  }
  if (dependencies.jupyterlab) {
    adapters.set('jupyter', {
      ...dependencies.jupyterlab,
      surface: 'jupyter',
      connect: (args) =>
        (dependencies.connectJupyterlab ?? connectJupyterlab)({
          server_url: args.server_url,
          notebook_path: args.notebook_path,
          token: args.token,
        }),
    });
  }
  return adapters;
}

export function registerCanonicalTools(server: McpServer, dependencies: CanonicalDependencies): void {
  const adapters = createAdapters(dependencies);
  const store = dependencies.taskStore ?? new TaskStore();
  let activeAdapter: SurfaceAdapter | undefined;
  let sourceHelperReady = false;

  function requireTask() {
    return store.requireActive();
  }

  function blocked(error: unknown): TextResult {
    return jsonText({ status: 'blocked', error: errorMessage(error) });
  }

  function taskEnvelope() {
    const ledger = requireTask();
    return { task: { id: ledger.taskId } };
  }

  async function stateOf(adapter: SurfaceAdapter): Promise<StateSnapshot> {
    return parseState(await adapter.getState());
  }

  function notebookReference(adapter: SurfaceAdapter, state: StateSnapshot, lazy: boolean) {
    return {
      surface: adapter.surface,
      ...(state.path ? { path: state.path } : {}),
      ...(state.uri ? { uri: state.uri } : {}),
      ...(lazy ? { lazy: true } : {}),
    };
  }

  async function ensureLedger(adapter: SurfaceAdapter, lazy: boolean, begin?: z.infer<typeof taskBeginSchema>) {
    const state = await stateOf(adapter);
    const turn = store.currentTurn();
    const current = store.active();
    const newTurn = Boolean(turn && current?.turnId !== turn.id);
    if (begin || !current || current.status === 'complete' || newTurn) {
      return store.begin({
        goal: begin?.goal ?? turn?.prompt,
        expectedOutput: begin?.expected_output,
        taskId: begin?.task_id,
        turnId: turn?.id,
        notebook: notebookReference(adapter, state, lazy),
      });
    }
    store.recordNotebook(notebookReference(adapter, state, lazy));
    return store.requireActive();
  }

  async function ensureReady(): Promise<SurfaceAdapter> {
    if (activeAdapter) {
      await ensureLedger(activeAdapter, Boolean(store.active()?.notebook?.lazy));
      return activeAdapter;
    }
    const onlySurface = adapters.size === 1 ? [...adapters.keys()][0] : undefined;
    const surface = dependencies.preferredSurface ?? onlySurface;
    if (!surface) {
      throw new TaskGateError(
        'Notebook auto-attach is ambiguous. Use connect once with surface and notebook details.'
      );
    }
    const adapter = adapters.get(surface);
    if (!adapter) throw new TaskGateError(`Surface ${surface} is not configured in this server.`);
    const result = await adapter.connect({ surface });
    if (!connectionSucceeded(result)) {
      throw new TaskGateError(
        `Notebook auto-attach failed: ${resultText(result)} Use connect with explicit notebook details.`
      );
    }
    activeAdapter = adapter;
    sourceHelperReady = false;
    await ensureLedger(adapter, true);
    store.noteAction('auto_attach');
    return adapter;
  }

  async function executionDelta(args: {
    adapter: SurfaceAdapter;
    before: StateSnapshot;
    result: NotebookResult;
    requestedIndex?: number;
    clearAllErrors?: boolean;
    returnOutput?: ExecutionOutput;
    imageIndex?: number;
    source?: string;
  }): Promise<NotebookResult> {
    const after = await stateOf(args.adapter);
    const body = resultText(args.result);
    const runAllFailure = args.clearAllErrors ? body.match(/stopped at cell\s+(\d+)/i) : undefined;
    const index = args.clearAllErrors
      ? runAllFailure ? Number(runAllFailure[1]) : undefined
      : inferCellIndex(body, after, args.requestedIndex);
    const cell = selectedCell(after, index);
    const discarded = /^discarded$/i.test(body.trim());
    if (discarded) {
      return jsonText({ status: 'discarded', surface: args.adapter.surface, ...taskEnvelope() });
    }
    const error = cell?.error ?? (/stopped at cell/i.test(body) ? truncate(body, 1000) : undefined);
    const ledger = store.markMutation({
      errorId: index === undefined ? (args.clearAllErrors ? 'run-all' : 'execution') : `cell-${index}`,
      error: error ?? undefined,
      clearAllErrors: args.clearAllErrors && !error,
    });
    const cellId = index ?? (args.clearAllErrors ? 'all' : 'unknown');
    const outputSummary = truncate(body || '[no output]', 500, false);
    const changedRunAllCells = args.clearAllErrors
      ? (after.cells ?? []).flatMap((candidate, position) => {
          const candidateId = candidate.index ?? position;
          const prior = selectedCell(args.before, candidateId);
          return candidate.executionCount !== null && candidate.executionCount !== undefined &&
            candidate.executionCount !== prior?.executionCount
            ? [{ candidate, candidateId }]
            : [];
        })
      : [];
    const recordedCells = changedRunAllCells.length
      ? changedRunAllCells
      : [{ candidate: cell, candidateId: cellId }];
    for (const recorded of recordedCells) {
      const executedSource = args.source ?? recorded.candidate?.source;
      store.recordCell({
        cellId: recorded.candidateId,
        surface: args.adapter.surface,
        executionCount: recorded.candidate?.executionCount,
        revision: ledger.mutationRevision,
        status: recorded.candidate?.error ? 'error' : error && recorded.candidateId === cellId ? 'error' : 'ok',
        ...(executedSource ? { sourceHash: shortHash(executedSource) } : {}),
        outputHash: shortHash(body),
        outputSummary,
      });
    }
    if (!error) {
      const artifacts = detectedArtifacts(args.source ?? cell?.source, cellId);
      if (artifacts.length) store.record({ artifacts });
    }
    const returnOutput = args.returnOutput ?? 'summary';
    const fullResult = index === undefined
      ? { action: 'read', kind: 'notebook' }
      : { action: 'read', kind: 'output', index };
    const delta = {
      cell: {
        id: cellId,
        execution_count: cell?.executionCount ?? null,
        revision: ledger.mutationRevision,
      },
      status: error ? 'error' : 'ok',
      changed_variables: changedVariables(args.before.variables, after.variables),
      output: returnOutput === 'none'
        ? { full_result: fullResult }
        : { summary: truncate(body || '[no output]', 1600), full_result: fullResult },
      errors: error ? [error] : [],
      warnings: warningsFrom(body),
      surface: args.adapter.surface,
      ...taskEnvelope(),
    };

    if ((returnOutput === 'images' || returnOutput === 'full') && index !== undefined) {
      try {
        const stored = await args.adapter.readCellOutput({ index });
        const output = storedOutputResponse(
          stored,
          returnOutput === 'images' ? 'images' : 'all',
          args.imageIndex
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(delta) }, ...output.content],
        };
      } catch (error) {
        delta.warnings.push(
          truncate(`execution succeeded, but the requested stored output could not be attached: ${errorMessage(error)}`, 300, false)
        );
      }
    }
    return jsonText(delta);
  }

  server.registerTool(
    'connect',
    {
      description:
        'Recovery and surface switching only. Ordinary inspect, run, read, and edit actions attach automatically; ' +
        'do not call connect first. Existing notebook state is preserved unless reset_kernel=true.',
      inputSchema: {
        surface: z.enum(['vscode', 'pycharm', 'jupyter']).optional(),
        server_url: z.string().optional(),
        token: z.string().optional(),
        notebook_path: z.string().optional(),
        notebook_file: z.string().optional().describe('Absolute .ipynb path required for PyCharm/DataSpell.'),
        reset_kernel: z.boolean().default(false).describe('Explicitly restart the selected kernel after connecting.'),
        begin: taskBeginSchema.optional().describe('Optional task label and expected output for the evidence ledger.'),
      },
    },
    async (args) => {
      try {
        const surface = args.surface ?? dependencies.preferredSurface;
        if (!surface) {
          return blocked(new TaskGateError('Name the active surface: vscode, pycharm, or jupyter.'));
        }
        const adapter = adapters.get(surface);
        if (!adapter) return blocked(new TaskGateError(`Surface ${surface} is not configured in this server.`));
        const previousAdapter = activeAdapter;
        const result = await adapter.connect(args);
        if (!connectionSucceeded(result)) return jsonText({ status: 'error', surface, message: resultText(result) });
        if (args.reset_kernel) {
          const restarted = await adapter.restartKernel();
          if (operationFailed(restarted)) {
            activeAdapter = previousAdapter;
            throw new TaskGateError(`Kernel reset failed: ${resultText(restarted)}`);
          }
        }
        activeAdapter = adapter;
        sourceHelperReady = false;
        const ledger = await ensureLedger(adapter, false, args.begin);
        store.noteAction('connect');
        return jsonText({
          status: 'connected',
          surface,
          ...(previousAdapter && previousAdapter.surface !== surface
            ? { switched_from: previousAdapter.surface }
            : {}),
          kernel_reset: args.reset_kernel,
          message: resultText(result),
          task: taskSummary(ledger),
        });
      } catch (error) {
        return blocked(error);
      }
    }
  );

  server.registerTool(
    'read',
    {
      description:
        'Read notebook content, compact state, or stored cell output. Output reads are text-only by default; ' +
        'request content="images" to view the first/selected image without loading every visualization.',
      inputSchema: {
        kind: z.enum(['state', 'notebook', 'output']).default('state'),
        index: z.number().int().optional(),
        offset: z.number().int().min(0).optional(),
        content: z.enum(['text', 'images', 'all', 'metadata']).default('text').describe(
          'For output reads: text is context-safe; images returns the first image unless image_index is set; all is explicit.'
        ),
        image_index: z.number().int().min(0).optional().describe('Zero-based stored image to return.'),
      },
    },
    async ({ kind, index, offset, content, image_index }) => {
      try {
        const adapter = await ensureReady();
        store.noteAction(`read.${kind}`);
        let result: NotebookResult;
        if (kind === 'notebook') result = await adapter.readNotebook();
        else if (kind === 'output') {
          if (index === undefined) throw new TaskGateError('read(kind="output") requires a cell index.');
          const page = await adapter.readCellOutput({ index, offset });
          const stored = offset && offset > 0
            ? {
                content: [
                  ...page.content,
                  ...(await adapter.readCellOutput({ index })).content.filter((block) => block.type === 'image'),
                ],
              }
            : page;
          result = storedOutputResponse(
            stored,
            content,
            image_index
          );
        } else result = await adapter.getState();
        if (kind !== 'output' && operationFailed(result)) {
          throw new TaskGateError(resultText(result));
        }
        store.markInspected({
          kind,
          surface: adapter.surface,
          ...(kind === 'output' && index !== undefined ? { target: String(index) } : {}),
        });
        if (kind === 'state') {
          return jsonText({ state: parseState(result), surface: adapter.surface, ...taskEnvelope() });
        }
        return result;
      } catch (error) {
        return blocked(error);
      }
    }
  );

  server.registerTool(
    'run',
    {
      description:
        'Append and run a durable code cell, rerun one cell, or run all cells. Returns a compact state delta; ' +
        'return_output="images" attaches the first/selected visualization in the same call.',
      inputSchema: {
        mode: z.enum(['append', 'cell', 'all']).default('append'),
        source: z.string().optional(),
        index: z.number().int().optional(),
        return_output: z.enum(['summary', 'images', 'full', 'none']).default('summary'),
        image_index: z.number().int().min(0).optional().describe('Zero-based image to attach for images/full output.'),
      },
    },
    async ({ mode, source, index, return_output, image_index }) => {
      try {
        const adapter = await ensureReady();
        store.noteAction(`run.${mode}`);
        store.assertCanExecute();
        if (mode === 'all' && (return_output === 'images' || return_output === 'full')) {
          throw new TaskGateError(
            'run(mode="all") supports summary or none; use read(kind="output") for a specific cell visualization.'
          );
        }
        if (image_index !== undefined && return_output !== 'images' && return_output !== 'full') {
          throw new TaskGateError('image_index requires return_output="images" or "full".');
        }
        const before = await stateOf(adapter);
        let result: NotebookResult;
        if (mode === 'append') {
          if (!source) throw new TaskGateError('run(mode="append") requires source.');
          result = await adapter.addAndRun({ source });
        } else if (mode === 'cell') {
          if (index === undefined) throw new TaskGateError('run(mode="cell") requires index.');
          result = await adapter.runCell({ index });
        } else {
          result = await adapter.runAllCells();
        }
        return executionDelta({
          adapter,
          before,
          result,
          requestedIndex: mode === 'cell' ? index : undefined,
          clearAllErrors: mode === 'all',
          returnOutput: return_output,
          imageIndex: image_index,
          source: mode === 'append' ? source : mode === 'cell' ? selectedCell(before, index)?.source : undefined,
        });
      } catch (error) {
        return blocked(error);
      }
    }
  );

  server.registerTool(
    'edit',
    {
      description: 'Replace, insert, delete, or add markdown through the active editor backend; optionally execute code edits.',
      inputSchema: {
        operation: z.enum(['replace', 'insert', 'delete', 'markdown']),
        index: z.number().int().optional(),
        source: z.string().optional(),
        execute: z.boolean().default(false),
        return_output: z.enum(['summary', 'images', 'full', 'none']).default('summary').describe(
          'For executing replace/insert operations; images attaches the first/selected visualization in this call.'
        ),
        image_index: z.number().int().min(0).optional().describe('Zero-based image to attach for images/full output.'),
      },
    },
    async ({ operation, index, source, execute, return_output, image_index }) => {
      try {
        const adapter = await ensureReady();
        store.noteAction(`edit.${operation}`);
        store.assertCanExecute();
        if (!execute && (return_output !== 'summary' || image_index !== undefined)) {
          throw new TaskGateError('return_output and image_index require execute=true.');
        }
        if (image_index !== undefined && return_output !== 'images' && return_output !== 'full') {
          throw new TaskGateError('image_index requires return_output="images" or "full".');
        }
        const before = await stateOf(adapter);
        let result: NotebookResult;
        let executed = false;
        if (operation === 'replace') {
          if (index === undefined || source === undefined) throw new TaskGateError('replace requires index and source.');
          result = execute
            ? await adapter.editAndRun({ index, source })
            : await adapter.editCell({ index, source });
          executed = execute;
        } else if (operation === 'insert') {
          if (index === undefined || source === undefined) throw new TaskGateError('insert requires index and source.');
          result = execute
            ? await adapter.addAndRun({ index, source })
            : await adapter.insertCell({ index, source });
          executed = execute;
        } else if (operation === 'delete') {
          if (index === undefined) throw new TaskGateError('delete requires index.');
          result = await adapter.deleteCell({ index });
        } else {
          if (source === undefined) throw new TaskGateError('markdown requires source.');
          result = await adapter.addMarkdown({ source, index });
        }
        if (executed) {
          return executionDelta({
            adapter,
            before,
            result,
            requestedIndex: index,
            returnOutput: return_output,
            imageIndex: image_index,
            source,
          });
        }
        const body = resultText(result);
        if (/^discarded$/i.test(body.trim())) {
          return jsonText({ status: 'discarded', surface: adapter.surface, ...taskEnvelope() });
        }
        const ledger = store.markMutation({ executed: false });
        return jsonText({
          status: 'ok',
          cell: { id: index ?? 'appended', revision: ledger.mutationRevision },
          change: truncate(body, 1200),
          surface: adapter.surface,
          ...taskEnvelope(),
        });
      } catch (error) {
        return blocked(error);
      }
    }
  );

  const sourceHeaderSchema = z.union([
    z.literal('auto'),
    z.literal('none'),
    z.number().int().min(0),
  ]).default('auto');
  const sourceSingleSchema = z.discriminatedUnion('view', [
    z.object({
      view: z.literal('inventory'),
      paths: z.array(z.string()).min(1).max(20),
      hash_contents: z.boolean().default(false),
      max_files: z.number().int().min(1).max(200).default(50),
    }),
    z.object({
      view: z.literal('schema'),
      path: z.string(),
      sheet: z.union([z.string(), z.number().int().min(0)]).optional(),
      header_row: sourceHeaderSchema,
      max_columns: z.number().int().min(1).max(100).default(50),
    }),
    z.object({
      view: z.literal('head'),
      path: z.string(),
      sheet: z.union([z.string(), z.number().int().min(0)]).optional(),
      header_row: sourceHeaderSchema,
      rows: z.number().int().min(1).max(20).default(5),
      max_columns: z.number().int().min(1).max(100).default(30),
    }),
    z.object({
      view: z.literal('profile'),
      path: z.string(),
      sheet: z.union([z.string(), z.number().int().min(0)]).optional(),
      header_row: sourceHeaderSchema,
      top_n: z.number().int().min(1).max(10).default(5),
      max_columns: z.number().int().min(1).max(100).default(30),
    }),
  ]);
  const sourceRequestSchema = z.union([
    sourceSingleSchema,
    z.object({
      view: z.literal('batch'),
      requests: z.array(sourceSingleSchema).min(1).max(8),
    }),
  ]);

  function canonicalSourceRequest(
    args: z.infer<typeof sourceSingleSchema>
  ): SourceInspectionSingleRequest {
    if (args.view === 'inventory') {
      return {
        view: 'inventory',
        paths: args.paths,
        hashContents: args.hash_contents,
        maxFiles: args.max_files,
      };
    }
    if (args.view === 'schema') {
      return {
        view: 'schema',
        path: args.path,
        sheet: args.sheet,
        headerRow: args.header_row,
        maxColumns: args.max_columns,
      };
    }
    if (args.view === 'head') {
      return {
        view: 'head',
        path: args.path,
        sheet: args.sheet,
        headerRow: args.header_row,
        rows: args.rows,
        maxColumns: args.max_columns,
      };
    }
    return {
      view: 'profile',
      path: args.path,
      sheet: args.sheet,
      headerRow: args.header_row,
      topN: args.top_n,
      maxColumns: args.max_columns,
    };
  }

  function sourceReferences(request: SourceInspectionRequest): SourceReference[] {
    const singles = request.view === 'batch' ? request.requests : [request];
    return singles.flatMap((item) => item.view === 'inventory'
      ? item.paths.map((uri) => ({ uri, role: 'inventory' }))
      : [{ uri: item.path, role: item.view }]);
  }

  server.registerTool(
    'inspect',
    {
      description:
        'Inspect one variable or one/batched source request. Prefer source.view="batch" to inspect compatible files once. ' +
        'Spreadsheet schema auto-detects the header row and returns sheet names, header candidates, and a raw preview. ' +
        'The response is a complete bounded summary; read the stored cell output only if it explicitly reports omitted detail.',
      inputSchema: {
        variable: z.object({
          name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
        }).optional(),
        source: sourceRequestSchema.optional(),
      },
    },
    async ({ variable, source }) => {
      try {
        const adapter = await ensureReady();
        if (Boolean(variable) === Boolean(source)) {
          throw new TaskGateError('inspect requires exactly one of variable or source.');
        }
        if (variable) {
          store.noteAction('inspect.variable');
          const result = await adapter.inspectVariable({ name: variable.name });
          if (!operationFailed(result)) {
          store.markInspected({ kind: 'variable', target: variable.name, surface: adapter.surface });
          }
          return jsonText({ variable: variable.name, summary: truncate(resultText(result), 1600), ...taskEnvelope() });
        }

        const args = source!;
        const request: SourceInspectionRequest = args.view === 'batch'
          ? { view: 'batch', requests: args.requests.map(canonicalSourceRequest) }
          : canonicalSourceRequest(args);
        store.noteAction('inspect.source');
        const before = await stateOf(adapter);
        store.markInspected({
          kind: 'source',
          target: sourceReferences(request).map((item) => item.uri).join(', '),
          surface: adapter.surface,
        });
        store.assertCanExecute();
        store.record({ sources: sourceReferences(request) });
        const includeHelper = !sourceHelperReady;
        const inspectionSource = sourceInspectionCode(request, { includeHelper });
        const result = await adapter.addAndRun({
          source: inspectionSource,
        });
        const response = await executionDelta({
          adapter,
          before,
          result,
          source: inspectionSource,
        });
        const responseBody = resultText(response);
        const succeeded = /"status":"ok"/.test(responseBody) || /"status":\s*"ok"/.test(responseBody);
        if (includeHelper && !operationFailed(result) && succeeded) sourceHelperReady = true;
        const compactObservation = compactSourceObservation(resultText(result));
        if (compactObservation && response.content[0]?.type === 'text') {
          try {
            const envelope = JSON.parse(response.content[0].text) as {
              output?: { summary?: string; observation?: unknown; full_result?: unknown };
            };
            if (envelope.output) {
              envelope.output = {
                observation: compactObservation,
                full_result: envelope.output.full_result,
              };
            }
            response.content[0].text = JSON.stringify(envelope);
          } catch {
            // Preserve the normal execution delta if an adapter returns non-JSON content.
          }
        }
        return response;
      } catch (error) {
        return blocked(error);
      }
    }
  );

  const factSchema = z.object({ statement: z.string().max(1000), evidence: z.string().max(1000) });
  const assumptionSchema = z.object({
    statement: z.string().max(1000),
    consequence: z.string().max(1000).optional(),
  });
  const artifactSchema = z.object({ uri: z.string().max(1000), description: z.string().max(1000).optional() });
  const riskSchema = z.object({ risk: z.string().max(1000), mitigation: z.string().max(1000).optional() });
  const sourceSchema = z.object({
    uri: z.string().max(1000),
    role: z.string().max(200).optional(),
    fingerprint: z.string().max(200).optional(),
  });
  const checkpointRecordSchema = z.object({
    validated_facts: z.array(factSchema).max(20).optional(),
    assumptions: z.array(assumptionSchema).max(20).optional(),
    artifacts: z.array(artifactSchema).max(20).optional(),
    open_risks: z.array(riskSchema).max(20).optional(),
    sources: z.array(sourceSchema).max(20).optional(),
    resolved_error_ids: z.array(z.string().max(200)).max(20).optional(),
  });
  const checkpointStatusSchema = z.object({
    section: z.enum(['summary', 'facts', 'assumptions', 'artifacts', 'risks', 'sources', 'errors']).default('summary'),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(20).default(10),
  });

  if (dependencies.includeAuditTools) {
    server.registerTool(
      'checkpoint',
    {
      description:
        'Optionally record durable facts, assumptions, artifacts, risks, or sources, or read the passive evidence ledger. ' +
        'This tool is not required for ordinary answers.',
      inputSchema: {
        record: checkpointRecordSchema.optional(),
        status: checkpointStatusSchema.optional(),
      },
    },
    async ({ record, status }) => {
      try {
        if ([record, status].filter(Boolean).length !== 1) {
          throw new TaskGateError('checkpoint requires exactly one of record or status.');
        }
        requireTask();
        if (record) {
          store.noteAction('checkpoint.record');
          const ledger = store.record({
            facts: record.validated_facts as ValidatedFact[] | undefined,
            assumptions: record.assumptions as Assumption[] | undefined,
            artifacts: record.artifacts as ArtifactReference[] | undefined,
            risks: record.open_risks as OpenRisk[] | undefined,
            sources: record.sources as SourceReference[] | undefined,
            resolvedErrorIds: record.resolved_error_ids,
          });
          return jsonText({
            status: 'recorded',
            task: taskSummary(ledger),
          });
        }
        store.noteAction('checkpoint.status');
        const ledger = store.requireActive();
        return jsonText({
          status: 'active',
          ...taskSection(ledger, status!.section, status!.offset, status!.limit),
        });
      } catch (error) {
        return blocked(error);
      }
    }
    );

    server.registerTool(
      'verify_clean_run',
    {
      description: 'Optionally save, restart, and run the notebook top-to-bottom to test reproducibility.',
      inputSchema: { confirm: z.literal(true) },
    },
    async () => {
      try {
        const adapter = await ensureReady();
        store.noteAction('verify_clean_run');
        store.assertCanVerify();
        const saved = await adapter.saveNotebook();
        if (operationFailed(saved)) throw new TaskGateError(`Notebook save failed: ${resultText(saved)}`);
        const restarted = await adapter.restartKernel();
        if (operationFailed(restarted)) throw new TaskGateError(`Kernel restart failed: ${resultText(restarted)}`);
        const before = await stateOf(adapter);
        const result = await adapter.runAllCells();
        await executionDelta({
          adapter,
          before,
          result,
          clearAllErrors: true,
          returnOutput: 'none',
        });
        const summary = cleanRunSummary(resultText(result));
        const passed = summary.includes('PASSED');
        const ledger = store.markVerified(passed, summary);
        return jsonText({
          status: passed ? 'passed' : 'failed',
          summary,
          surface: adapter.surface,
          task: { id: ledger.taskId },
          evidence: store.evidenceStatus(ledger),
        });
      } catch (error) {
        return blocked(error);
      }
    }
    );

    server.registerTool(
      'publish_answer',
    {
      description:
        'Optionally record a compact audit receipt for a bounded result and executed evidence. ' +
        'Do not call this for an ordinary answer unless a receipt is useful.',
      inputSchema: {
        result: z.object({
          shape: resultShapeSchema,
          value: z.union([
            z.string().max(2000),
            z.number(),
            z.boolean(),
            z.null(),
            z.array(z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).max(100),
          ]).optional().describe('Scalar or short list only; keep long lists/tables in the evidenced cell or artifact.'),
          summary: z.string().max(2000).optional().describe('Bounded result summary, not the complete chat answer.'),
          unit: z.string().max(100).optional(),
          artifact_uri: z.string().max(1000).optional().describe('Reference for a long table, list, report, or other artifact.'),
        }),
        evidence: z.array(z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('cell'),
            cell_id: z.number().int().min(0),
            surface: z.enum(['vscode', 'pycharm', 'jupyter']).optional().describe(
              'Surface containing the cell; defaults to the currently active surface.'
            ),
            revision: z.number().int().min(0).optional(),
            description: z.string().max(500).optional(),
          }),
          z.object({
            kind: z.literal('artifact'),
            uri: z.string().max(1000),
            description: z.string().max(500).optional(),
          }),
        ])).min(1).max(20),
        assumptions: z.array(assumptionSchema).max(20).optional(),
        open_risks: z.array(riskSchema).max(20).optional(),
      },
    },
    async ({ result, evidence, assumptions, open_risks }) => {
      try {
        const adapter = await ensureReady();
        const states = new Map<Surface, StateSnapshot>();
        for (const item of evidence) {
          if (item.kind !== 'cell') continue;
          const evidenceSurface = item.surface ?? adapter.surface;
          const evidenceAdapter = adapters.get(evidenceSurface);
          if (!evidenceAdapter) {
            throw new TaskGateError(`Evidence surface ${evidenceSurface} is unavailable.`);
          }
          let state = states.get(evidenceSurface);
          if (!state) {
            state = await stateOf(evidenceAdapter);
            states.set(evidenceSurface, state);
          }
          const cell = selectedCell(state, item.cell_id);
          if (!cell || cell.executionCount === null || cell.executionCount === undefined) {
            throw new TaskGateError(
              `Evidence cell ${item.cell_id} on ${evidenceSurface} does not exist or has not executed.`
            );
          }
          if (cell.error) {
            throw new TaskGateError(`Evidence cell ${item.cell_id} on ${evidenceSurface} has an unresolved error.`);
          }
        }
        store.finalize({
          result: {
            shape: result.shape,
            value: result.value,
            summary: result.summary,
            unit: result.unit,
            artifactUri: result.artifact_uri,
          },
          evidence: evidence.map((item) => item.kind === 'cell'
            ? {
                kind: 'cell' as const,
                cellId: item.cell_id,
                surface: item.surface ?? adapter.surface,
                revision: item.revision,
                description: item.description,
              }
            : {
                kind: 'artifact' as const,
                uri: item.uri,
                description: item.description,
              }),
          assumptions: assumptions as Assumption[] | undefined,
          risks: open_risks as OpenRisk[] | undefined,
        });
        const ledger = store.noteAction('publish_answer');
        return jsonText({
          status: 'recorded',
          receipt: ledger.finalization && {
            result_shape: ledger.finalization.resultShape,
            result_hash: ledger.finalization.resultHash,
            evidence_count: ledger.finalization.evidenceCount,
            finalized_at: ledger.finalization.finalizedAt,
          },
          task: { id: ledger.taskId, status: ledger.status },
        });
      } catch (error) {
        return blocked(error);
      }
    }
    );
  }
}
