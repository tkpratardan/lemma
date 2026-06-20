// Client for the VS Code / Cursor notebook bridge (the in-editor HTTP server).
// Discovers the Lemma extension's local HTTP server (newest reachable
// ~/.lemma/vscode-*.json) and talks to it, so edits land live in the editor
// with no disk write.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DISCOVERY_DIR = path.join(os.homedir(), '.lemma');

// Cell execution in the editor can take a while; allow for it but stay bounded.
const TIMEOUT_MS = 130000;

// Run-all spans many sequential cell executions, so it gets its own budget.
const RUN_ALL_TIMEOUT_MS = 600000;

// Mutating calls block on the confirm-edit gate (a human Accept/Discard),
// which has no natural time bound, unlike plain execution time above.
const CONFIRM_TIMEOUT_MS = null;

export interface BridgeInfo {
  url: string;
  token: string;
  pid: number;
}

interface CellSummary {
  source: string;
  cellType?: string;
  executionCount?: number | null;
  error?: string | null;
}

interface HealthResponse {
  ok: boolean;
}

interface OpenResponse {
  notebooks: string[];
}

interface StateResponse {
  cells: CellSummary[];
  variables?: Record<string, unknown>;
  path?: string;
}

interface ExecuteResponse {
  index: number;
  output: string;
  discarded?: boolean;
}

interface InsertResponse {
  index: number;
  diff: string;
  discarded?: boolean;
}

interface DiffResponse {
  diff: string;
  discarded?: boolean;
}

interface EditAndRunResponse {
  diff: string;
  output: string;
  discarded?: boolean;
}

interface RunAllResponse {
  ran: number;
  codeCells: number;
  failedAt?: number;
  outputs: Array<{ index: number; output: string }>;
}

interface OutputResponse {
  text: string;
  images: Array<{ mime: string; base64: string }>;
}

interface RestartResponse {
  message: string;
}

interface ClearResponse {
  cleared: number;
}

interface SaveResponse {
  saved: boolean;
}

export class Editor {
  constructor(private bridge: BridgeInfo) {}

  private async req(
    method: string,
    route: string,
    notebookPath?: string,
    payload?: unknown,
    timeoutMs: number | null = TIMEOUT_MS
  ): Promise<unknown> {
    const qs = notebookPath ? `?path=${encodeURIComponent(notebookPath)}` : '';
    const res = await fetch(this.bridge.url + route + qs, {
      method,
      headers: { 'x-lemma-token': this.bridge.token, 'Content-Type': 'application/json' },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
      signal: timeoutMs === null ? undefined : AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(String(body?.['error'] ?? `HTTP ${res.status}`));
    }
    return body;
  }

  health(): Promise<HealthResponse> {
    return this.req('GET', '/health') as Promise<HealthResponse>;
  }

  open(): Promise<OpenResponse> {
    return this.req('GET', '/open') as Promise<OpenResponse>;
  }

  read(path: string): Promise<unknown> {
    return this.req('GET', '/read', path);
  }

  state(path: string): Promise<StateResponse> {
    return this.req('GET', '/state', path) as Promise<StateResponse>;
  }

  execute(path: string, code: string): Promise<ExecuteResponse> {
    return this.req('POST', '/execute', path, { code }, CONFIRM_TIMEOUT_MS) as Promise<ExecuteResponse>;
  }

  addAndRun(path: string, source: string, index?: number): Promise<ExecuteResponse> {
    return this.req(
      'POST',
      '/add_and_run',
      path,
      index !== undefined ? { source, index } : { source },
      CONFIRM_TIMEOUT_MS
    ) as Promise<ExecuteResponse>;
  }

  run(path: string, index: number): Promise<{ output: string }> {
    return this.req('POST', '/run', path, { index }) as Promise<{ output: string }>;
  }

  runAll(path: string): Promise<RunAllResponse> {
    return this.req('POST', '/run_all', path, {}, RUN_ALL_TIMEOUT_MS) as Promise<RunAllResponse>;
  }

  edit(path: string, index: number, source: string): Promise<DiffResponse> {
    return this.req('POST', '/edit', path, { index, source }, CONFIRM_TIMEOUT_MS) as Promise<DiffResponse>;
  }

  editAndRun(path: string, index: number, source: string): Promise<EditAndRunResponse> {
    return this.req(
      'POST',
      '/edit_and_run',
      path,
      { index, source },
      CONFIRM_TIMEOUT_MS
    ) as Promise<EditAndRunResponse>;
  }

  insert(path: string, index: number, source: string): Promise<InsertResponse> {
    return this.req('POST', '/insert', path, { index, source }, CONFIRM_TIMEOUT_MS) as Promise<InsertResponse>;
  }

  delete(path: string, index: number): Promise<DiffResponse> {
    return this.req('POST', '/delete', path, { index }, CONFIRM_TIMEOUT_MS) as Promise<DiffResponse>;
  }

  markdown(path: string, source: string, index?: number): Promise<InsertResponse> {
    return this.req(
      'POST',
      '/markdown',
      path,
      index !== undefined ? { source, index } : { source },
      CONFIRM_TIMEOUT_MS
    ) as Promise<InsertResponse>;
  }

  output(path: string, index: number): Promise<OutputResponse> {
    return this.req('POST', '/output', path, { index }) as Promise<OutputResponse>;
  }

  restart(path: string): Promise<RestartResponse> {
    return this.req('POST', '/restart', path) as Promise<RestartResponse>;
  }

  inspect(path: string, name: string): Promise<{ output: string }> {
    return this.req('POST', '/inspect', path, { name }) as Promise<{ output: string }>;
  }

  probe(path: string, code: string): Promise<{ output: string }> {
    return this.req('POST', '/probe', path, { code }) as Promise<{ output: string }>;
  }

  clear(path: string): Promise<ClearResponse> {
    return this.req('POST', '/clear', path) as Promise<ClearResponse>;
  }

  save(path: string): Promise<SaveResponse> {
    return this.req('POST', '/save', path) as Promise<SaveResponse>;
  }
}

// All advertised editor bridges, newest first by discovery-file mtime.
// One file per editor process (pid in the name) so multiple open windows
// don't clobber each other.
export function discoverBridges(): BridgeInfo[] {
  let files: string[];
  try {
    files = fs
      .readdirSync(DISCOVERY_DIR)
      .filter((f) => f.startsWith('vscode-') && f.endsWith('.json'))
      .map((f) => path.join(DISCOVERY_DIR, f));
  } catch {
    return [];
  }
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const bridges: BridgeInfo[] = [];
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      bridges.push({ url: d.url, token: d.token, pid: Number(d.pid ?? 0) });
    } catch {
      continue;
    }
  }
  return bridges;
}

// The newest reachable editor bridge, or null if none is open. Stale
// discovery files (editor killed) are skipped because /health fails.
export async function findEditor(): Promise<Editor | null> {
  for (const b of discoverBridges()) {
    const ed = new Editor(b);
    try {
      await ed.health();
      return ed;
    } catch {
      continue;
    }
  }
  return null;
}
