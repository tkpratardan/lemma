import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type ResultShape = 'scalar' | 'list' | 'table' | 'narrative' | 'report' | 'artifact';
export type TaskStatus = 'active' | 'complete';

export interface ExpectedOutput {
  shape: ResultShape;
  description?: string;
  unit?: string;
}

export type ResultValue = string | number | boolean | null | Array<string | number | boolean | null>;

export interface FinalResult {
  shape: ResultShape;
  value?: ResultValue;
  summary?: string;
  unit?: string;
  artifactUri?: string;
}

export type EvidenceReference =
  | { kind: 'cell'; cellId: string | number; surface?: string; revision?: number; description?: string }
  | { kind: 'artifact'; uri: string; description?: string };

export interface FinalizationRecord {
  resultShape: ResultShape;
  resultHash: string;
  evidenceCount: number;
  evidence: EvidenceReference[];
  finalizedAt: string;
}

export interface ValidatedFact {
  statement: string;
  evidence: string;
}

export interface Assumption {
  statement: string;
  consequence?: string;
}

export interface ArtifactReference {
  uri: string;
  description?: string;
}

export interface OpenRisk {
  risk: string;
  mitigation?: string;
}

export interface SourceReference {
  uri: string;
  role?: string;
  fingerprint?: string;
}

export interface ExecutionError {
  id: string;
  message: string;
}

export interface NotebookReference {
  surface: string;
  path?: string;
  uri?: string;
  connectedAt: string;
  lazy?: boolean;
}

export interface CellEvidence {
  cellId: string | number;
  surface?: string;
  revision: number;
  status: 'ok' | 'error';
  executionCount?: number | null;
  sourceHash?: string;
  outputHash?: string;
  outputSummary?: string;
  recordedAt: string;
}

export interface ObservationReference {
  kind: 'state' | 'notebook' | 'output' | 'variable' | 'source';
  surface?: string;
  target?: string;
  recordedAt: string;
}

export interface TurnContext {
  id: string;
  prompt?: string;
  beganAt?: string;
}

/** Passive evidence ledger. It records work but never dictates its order. */
export interface TaskLedger {
  schemaVersion: 6;
  taskId: string;
  turnId?: string;
  namespace: string;
  projectRoot: string;
  goal: string;
  expectedOutput?: ExpectedOutput;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  mutationRevision: number;
  executionCount: number;
  lastAction?: string;
  verifiedRevision?: number;
  cleanVerifiedAt?: string;
  facts: ValidatedFact[];
  assumptions: Assumption[];
  artifacts: ArtifactReference[];
  risks: OpenRisk[];
  sources: SourceReference[];
  cells: CellEvidence[];
  observations: ObservationReference[];
  notebook?: NotebookReference;
  notebooks: NotebookReference[];
  unresolvedErrors: ExecutionError[];
  finalization?: FinalizationRecord;
}

export interface EvidenceStatus {
  status: TaskStatus;
  clean: boolean;
  unresolvedErrors: number;
  mutationRevision: number;
  executionCount: number;
  cellEvidence: number;
  observations: number;
  verifiedRevision?: number;
}

export class TaskGateError extends Error {}

function now(): string {
  return new Date().toISOString();
}

function safeId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return slug || 'task';
}

function compact<T>(items: T[], limit = 50): T[] {
  return items.slice(-limit);
}

function appendUnique<T>(current: T[], additions: T[], key: (item: T) => string): T[] {
  const byKey = new Map(current.map((item) => [key(item), item]));
  for (const item of additions) byKey.set(key(item), item);
  return compact([...byKey.values()]);
}

function boundedExpectedOutput(value: ExpectedOutput | undefined): ExpectedOutput | undefined {
  if (!value) return undefined;
  return {
    shape: value.shape,
    ...(value.description ? { description: value.description.slice(0, 500) } : {}),
    ...(value.unit ? { unit: value.unit.slice(0, 100) } : {}),
  };
}

function boundedNotebook(
  value: Omit<NotebookReference, 'connectedAt'> & { connectedAt?: string },
  fallbackTimestamp = now()
): NotebookReference {
  return {
    surface: value.surface.slice(0, 50),
    ...(value.path ? { path: value.path.slice(0, 1000) } : {}),
    ...(value.uri ? { uri: value.uri.slice(0, 1000) } : {}),
    connectedAt: value.connectedAt ?? fallbackTimestamp,
    ...(value.lazy ? { lazy: true } : {}),
  };
}

function notebookKey(value: NotebookReference): string {
  return `${value.surface}\n${value.path ?? ''}\n${value.uri ?? ''}`;
}

export class TaskStore {
  private readonly namespace: string;
  private readonly directory: string;
  private readonly activePath: string;
  private readonly turnPath: string;

  constructor(
    private readonly projectRoot = process.cwd(),
    baseDirectory = path.join(os.homedir(), '.lemma', 'tasks')
  ) {
    this.namespace = crypto.createHash('sha256').update(path.resolve(projectRoot)).digest('hex').slice(0, 12);
    this.directory = path.join(baseDirectory, this.namespace);
    this.activePath = path.join(this.directory, 'active.json');
    this.turnPath = path.join(os.homedir(), '.lemma', `turn-${this.namespace}.json`);
  }

  begin(args: {
    goal?: string;
    expectedOutput?: ExpectedOutput;
    taskId?: string;
    turnId?: string;
    notebook?: Omit<NotebookReference, 'connectedAt'> & { connectedAt?: string };
  } = {}): TaskLedger {
    const goal = args.goal?.trim() || 'Notebook analysis';
    const taskId = args.taskId
      ? safeId(args.taskId)
      : `${safeId(goal)}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
    const timestamp = now();
    const ledger: TaskLedger = {
      schemaVersion: 6,
      taskId,
      ...(args.turnId ? { turnId: args.turnId.slice(0, 200) } : {}),
      namespace: this.namespace,
      projectRoot: path.resolve(this.projectRoot),
      goal: goal.slice(0, 1000),
      ...(args.expectedOutput ? { expectedOutput: boundedExpectedOutput(args.expectedOutput) } : {}),
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
      mutationRevision: 0,
      executionCount: 0,
      facts: [],
      assumptions: [],
      artifacts: [],
      risks: [],
      sources: [],
      cells: [],
      observations: [],
      notebooks: args.notebook ? [boundedNotebook(args.notebook, timestamp)] : [],
      ...(args.notebook ? {
        notebook: boundedNotebook(args.notebook, timestamp),
      } : {}),
      unresolvedErrors: [],
    };
    this.write(ledger);
    return ledger;
  }

  active(): TaskLedger | undefined {
    try {
      const raw = JSON.parse(fs.readFileSync(this.activePath, 'utf8')) as Record<string, unknown>;
      const legacyStage = typeof raw.stage === 'string' ? raw.stage : undefined;
      return {
        schemaVersion: 6,
        taskId: String(raw.taskId ?? 'task'),
        ...(raw.turnId ? { turnId: String(raw.turnId) } : {}),
        namespace: String(raw.namespace ?? this.namespace),
        projectRoot: String(raw.projectRoot ?? path.resolve(this.projectRoot)),
        goal: String(raw.goal ?? 'Notebook analysis'),
        ...(raw.expectedOutput ? { expectedOutput: boundedExpectedOutput(raw.expectedOutput as ExpectedOutput) } : {}),
        status: raw.status === 'complete' || legacyStage === 'complete' ? 'complete' : 'active',
        createdAt: String(raw.createdAt ?? now()),
        updatedAt: String(raw.updatedAt ?? now()),
        mutationRevision: Number(raw.mutationRevision ?? 0),
        executionCount: Number(raw.executionCount ?? raw.mutationRevision ?? 0),
        ...(raw.lastAction ? { lastAction: String(raw.lastAction) } : {}),
        ...(raw.verifiedRevision !== undefined ? { verifiedRevision: Number(raw.verifiedRevision) } : {}),
        ...(raw.cleanVerifiedAt ? { cleanVerifiedAt: String(raw.cleanVerifiedAt) } : {}),
        facts: Array.isArray(raw.facts) ? raw.facts as ValidatedFact[] : [],
        assumptions: Array.isArray(raw.assumptions) ? raw.assumptions as Assumption[] : [],
        artifacts: Array.isArray(raw.artifacts) ? raw.artifacts as ArtifactReference[] : [],
        risks: Array.isArray(raw.risks) ? raw.risks as OpenRisk[] : [],
        sources: Array.isArray(raw.sources) ? raw.sources as SourceReference[] : [],
        cells: Array.isArray(raw.cells) ? raw.cells as CellEvidence[] : [],
        observations: Array.isArray(raw.observations) ? raw.observations as ObservationReference[] : [],
        ...(raw.notebook ? { notebook: raw.notebook as NotebookReference } : {}),
        notebooks: Array.isArray(raw.notebooks)
          ? raw.notebooks as NotebookReference[]
          : raw.notebook ? [raw.notebook as NotebookReference] : [],
        unresolvedErrors: Array.isArray(raw.unresolvedErrors) ? raw.unresolvedErrors as ExecutionError[] : [],
        ...(raw.finalization ? { finalization: raw.finalization as FinalizationRecord } : {}),
      };
    } catch {
      return undefined;
    }
  }

  currentTurn(): TurnContext | undefined {
    try {
      const raw = JSON.parse(fs.readFileSync(this.turnPath, 'utf8')) as Record<string, unknown>;
      if (!raw.id) return undefined;
      return {
        id: String(raw.id).slice(0, 200),
        ...(raw.prompt ? { prompt: String(raw.prompt).slice(0, 1000) } : {}),
        ...(raw.beganAt ? { beganAt: String(raw.beganAt) } : {}),
      };
    } catch {
      return undefined;
    }
  }

  requireActive(): TaskLedger {
    const ledger = this.active();
    if (!ledger) throw new TaskGateError('No evidence ledger is active. Connect to a notebook first.');
    return ledger;
  }

  noteAction(action: string): TaskLedger {
    const ledger = this.requireActive();
    ledger.lastAction = action.slice(0, 100);
    this.write(ledger);
    return ledger;
  }

  markInspected(args?: {
    kind?: ObservationReference['kind'];
    target?: string;
    surface?: string;
  }): TaskLedger {
    const ledger = this.requireActive();
    if (args?.kind) {
      ledger.observations = compact([
        ...ledger.observations,
        {
          kind: args.kind,
          ...(args.surface ? { surface: args.surface.slice(0, 50) } : {}),
          ...(args.target ? { target: args.target.slice(0, 1000) } : {}),
          recordedAt: now(),
        },
      ], 100);
    }
    this.write(ledger);
    return ledger;
  }

  recordNotebook(args: Omit<NotebookReference, 'connectedAt'> & { connectedAt?: string }): TaskLedger {
    const ledger = this.requireActive();
    const candidate = boundedNotebook(args);
    const previous = ledger.notebooks.find((item) => notebookKey(item) === notebookKey(candidate));
    const notebook = previous
      ? { ...candidate, connectedAt: previous.connectedAt, ...(previous.lazy || candidate.lazy ? { lazy: true } : {}) }
      : candidate;
    ledger.notebook = notebook;
    ledger.notebooks = appendUnique(ledger.notebooks, [notebook], notebookKey);
    this.write(ledger);
    return ledger;
  }

  recordCell(args: {
    cellId: string | number;
    revision: number;
    status: 'ok' | 'error';
    surface?: string;
    executionCount?: number | null;
    sourceHash?: string;
    outputHash?: string;
    outputSummary?: string;
  }): TaskLedger {
    const ledger = this.requireActive();
    const item: CellEvidence = {
      cellId: args.cellId,
      ...(args.surface ? { surface: args.surface.slice(0, 50) } : {}),
      revision: args.revision,
      status: args.status,
      ...(args.executionCount !== undefined ? { executionCount: args.executionCount } : {}),
      ...(args.sourceHash ? { sourceHash: args.sourceHash.slice(0, 64) } : {}),
      ...(args.outputHash ? { outputHash: args.outputHash.slice(0, 64) } : {}),
      ...(args.outputSummary ? { outputSummary: args.outputSummary.slice(0, 500) } : {}),
      recordedAt: now(),
    };
    ledger.cells = appendUnique(
      ledger.cells,
      [item],
      (cell) => `${cell.surface ?? ''}:${String(cell.cellId)}:${cell.revision}`
    );
    this.write(ledger);
    return ledger;
  }

  assertCanExecute(): TaskLedger {
    return this.requireActive();
  }

  markMutation(args: { errorId?: string; error?: string; clearAllErrors?: boolean; executed?: boolean }): TaskLedger {
    const ledger = this.requireActive();
    ledger.status = 'active';
    ledger.finalization = undefined;
    ledger.mutationRevision += 1;
    if (args.executed !== false) ledger.executionCount += 1;
    ledger.verifiedRevision = undefined;
    ledger.cleanVerifiedAt = undefined;
    if (args.clearAllErrors) ledger.unresolvedErrors = [];
    if (args.errorId && args.error) {
      ledger.unresolvedErrors = appendUnique(
        ledger.unresolvedErrors,
        [{ id: args.errorId, message: args.error.slice(0, 1000) }],
        (item) => item.id
      );
    } else if (args.executed !== false) {
      // A later successful execution is the only mechanical signal the
      // runtime has that the model recovered. Failed cells remain in the cell
      // evidence history, but no longer block an answer from newer evidence.
      ledger.unresolvedErrors = [];
    }
    this.write(ledger);
    return ledger;
  }

  record(args: {
    facts?: ValidatedFact[];
    assumptions?: Assumption[];
    artifacts?: ArtifactReference[];
    risks?: OpenRisk[];
    sources?: SourceReference[];
    resolvedErrorIds?: string[];
  }): TaskLedger {
    const ledger = this.requireActive();
    ledger.facts = appendUnique(ledger.facts, args.facts ?? [], (item) => `${item.statement}\n${item.evidence}`);
    ledger.assumptions = appendUnique(ledger.assumptions, args.assumptions ?? [], (item) => item.statement);
    ledger.artifacts = appendUnique(ledger.artifacts, args.artifacts ?? [], (item) => item.uri);
    ledger.risks = appendUnique(ledger.risks, args.risks ?? [], (item) => item.risk);
    ledger.sources = appendUnique(ledger.sources, args.sources ?? [], (item) => item.uri);
    if (args.resolvedErrorIds?.length) {
      const resolved = new Set(args.resolvedErrorIds);
      ledger.unresolvedErrors = ledger.unresolvedErrors.filter((item) => !resolved.has(item.id));
    }
    this.write(ledger);
    return ledger;
  }

  assertCanVerify(): TaskLedger {
    // A clean run is itself the mechanism that can resolve a failed cell.
    return this.requireActive();
  }

  markVerified(passed: boolean, message?: string): TaskLedger {
    const ledger = this.requireActive();
    if (!passed) {
      ledger.unresolvedErrors = appendUnique(
        ledger.unresolvedErrors,
        [{ id: 'clean-run', message: (message ?? 'Clean run failed').slice(0, 1000) }],
        (item) => item.id
      );
    } else {
      ledger.unresolvedErrors = [];
      ledger.verifiedRevision = ledger.mutationRevision;
      ledger.cleanVerifiedAt = now();
    }
    this.write(ledger);
    return ledger;
  }

  finalize(args: {
    result: FinalResult;
    evidence: EvidenceReference[];
    assumptions?: Assumption[];
    risks?: OpenRisk[];
  }): TaskLedger {
    const ledger = this.requireActive();
    if (
      args.result.value === undefined &&
      !args.result.summary?.trim() &&
      !args.result.artifactUri?.trim()
    ) {
      throw new TaskGateError('The optional receipt requires a bounded value, summary, or artifact reference.');
    }
    if (!args.evidence.length) {
      throw new TaskGateError('The optional receipt requires at least one cell or artifact evidence reference.');
    }
    for (const evidence of args.evidence) {
      if (evidence.kind === 'cell' && evidence.revision !== undefined && evidence.revision > ledger.mutationRevision) {
        throw new TaskGateError(
          `Evidence revision ${evidence.revision} is newer than notebook revision ${ledger.mutationRevision}.`
        );
      }
    }
    if (ledger.unresolvedErrors.length) {
      throw new TaskGateError(`Cannot record a receipt with ${ledger.unresolvedErrors.length} unresolved cell error(s).`);
    }
    ledger.assumptions = appendUnique(ledger.assumptions, args.assumptions ?? [], (item) => item.statement);
    ledger.risks = appendUnique(ledger.risks, args.risks ?? [], (item) => item.risk);
    const boundedResult: FinalResult = {
      shape: args.result.shape,
      ...(args.result.value !== undefined ? { value: args.result.value } : {}),
      ...(args.result.summary ? { summary: args.result.summary.slice(0, 2000) } : {}),
      ...(args.result.unit ? { unit: args.result.unit.slice(0, 100) } : {}),
      ...(args.result.artifactUri ? { artifactUri: args.result.artifactUri.slice(0, 1000) } : {}),
    };
    const boundedEvidence = args.evidence.slice(0, 20).map((item): EvidenceReference => item.kind === 'cell'
      ? {
          kind: 'cell',
          cellId: item.cellId,
          ...(item.surface ? { surface: item.surface.slice(0, 50) } : {}),
          ...(item.revision !== undefined ? { revision: item.revision } : {}),
          ...(item.description ? { description: item.description.slice(0, 500) } : {}),
        }
      : {
          kind: 'artifact',
          uri: item.uri.slice(0, 1000),
          ...(item.description ? { description: item.description.slice(0, 500) } : {}),
        });
    ledger.finalization = {
      resultShape: boundedResult.shape,
      resultHash: crypto.createHash('sha256').update(JSON.stringify(boundedResult)).digest('hex').slice(0, 16),
      evidenceCount: boundedEvidence.length,
      evidence: boundedEvidence,
      finalizedAt: now(),
    };
    ledger.status = 'complete';
    this.write(ledger);
    return ledger;
  }

  evidenceStatus(ledger = this.requireActive()): EvidenceStatus {
    return {
      status: ledger.status,
      clean: ledger.verifiedRevision === ledger.mutationRevision && Boolean(ledger.cleanVerifiedAt),
      unresolvedErrors: ledger.unresolvedErrors.length,
      mutationRevision: ledger.mutationRevision,
      executionCount: ledger.executionCount,
      cellEvidence: ledger.cells.length,
      observations: ledger.observations.length,
      ...(ledger.verifiedRevision !== undefined ? { verifiedRevision: ledger.verifiedRevision } : {}),
    };
  }

  private write(ledger: TaskLedger): void {
    ledger.updatedAt = now();
    fs.mkdirSync(this.directory, { recursive: true });
    const taskPath = path.join(this.directory, `${ledger.taskId}.json`);
    const temporary = `${taskPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, taskPath);
    fs.writeFileSync(this.activePath, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  }
}
