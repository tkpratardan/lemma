// JupyterLab RTC session: live-edit a notebook open in the user's browser tab.
//
// Uses @jupyter/ydoc (YNotebook, the Yjs document model) + y-websocket
// (WebsocketProvider, the generic Yjs sync-protocol transport) for RTC,
// and @jupyterlab/services for kernel execution.
import { YNotebook } from '@jupyter/ydoc';
import { WebsocketProvider } from 'y-websocket';
import { KernelManager, ServerConnection, SessionManager } from '@jupyterlab/services';
import type { Kernel, Session } from '@jupyterlab/services';
import { cellsFromNb, toNbOutputs } from '../../utils/notebookStore.js';
import { renderForAgent, type Cell, type CellOutput } from '../../utils/render.js';
import type { JupyterSession } from '../../utils/jupyterApi.js';

const VARS_MARKER = '<<LEMMA_VARS>>';

const INSPECT_PY = `
def __lemma_inspect():
    import json as __json, types as __types
    __skip = {"In", "Out", "exit", "quit", "get_ipython", "open"}
    __out = {}
    for __k, __v in list(globals().items()):
        if __k.startswith("_") or __k in __skip:
            continue
        if isinstance(__v, __types.ModuleType) or callable(__v):
            continue
        try:
            __info = {"type": type(__v).__name__}
            if hasattr(__v, "shape"):
                __info["shape"] = str(getattr(__v, "shape"))
            elif hasattr(__v, "__len__"):
                try:
                    __info["len"] = len(__v)
                except Exception:
                    pass
            __info["preview"] = repr(__v)[:160]
            __out[__k] = __info
        except Exception:
            pass
    print("${VARS_MARKER}" + __json.dumps(__out))
__lemma_inspect()
`;

// String.raw: same reason the Python original is an r"""...""" string:
// disables JS's own backslash-escape processing so what's on the page is
// exactly the R source (R's own "\\" / "\"" escapes pass through untouched).
// TODO: Remove R support. We will add this in a future feature release.
const INSPECT_R = String.raw`
local({
  .esc <- function(s) {
    s <- gsub("\\", "\\\\", s, fixed=TRUE)
    s <- gsub("\"", "\\\"", s, fixed=TRUE)
    gsub("[\r\n\t]", " ", s)
  }
  .parts <- character(0)
  for (.n in ls(envir=.GlobalEnv)) {
    if (startsWith(.n, ".")) next
    .v <- tryCatch(get(.n, envir=.GlobalEnv), error=function(e) NULL)
    if (is.function(.v) || is.null(.v)) next
    .info <- paste0("\"type\":\"", .esc(paste(class(.v), collapse=",")), "\"")
    .dm <- tryCatch(dim(.v), error=function(e) NULL)
    if (!is.null(.dm)) {
      .info <- paste0(.info, ",\"shape\":\"", paste(.dm, collapse="x"), "\"")
    } else {
      .ln <- tryCatch(length(.v), error=function(e) NA)
      if (!is.na(.ln)) .info <- paste0(.info, ",\"len\":", .ln)
    }
    .pv <- tryCatch(paste(utils::capture.output(str(.v)), collapse=" "),
                    error=function(e) "")
    .info <- paste0(.info, ",\"preview\":\"", .esc(substr(.pv, 1, 160)), "\"")
    .parts <- c(.parts, paste0("\"", .esc(.n), "\":{", .info, "}"))
  }
  cat("` + VARS_MARKER + String.raw`{", paste(.parts, collapse=","), "}\n", sep="")
})
`;

function showPySnippet(name: string): string {
  // JSON.stringify produces a valid Python string literal for any plain
  // identifier (the MCP tool layer already validated it's one).
  const literal = JSON.stringify(name);
  return (
    'def _lemma_show(_n):\n' +
    '    import pprint\n' +
    "    if _n not in globals():\n" +
    "        print('NameError: ' + _n + ' is not defined'); return\n" +
    '    _v = globals()[_n]\n' +
    '    print(type(_v).__name__)\n' +
    "    if hasattr(_v, 'shape'):\n" +
    "        print('shape', _v.shape)\n" +
    "    elif hasattr(_v, '__len__'):\n" +
    '        try: print(\'len\', len(_v))\n' +
    '        except Exception: pass\n' +
    '    pprint.pprint(_v)\n' +
    `_lemma_show(${literal})\n`
  );
}

function showRSnippet(name: string): string {
  return (
    `if (!exists("${name}", envir=.GlobalEnv)) {\n` +
    `  cat("object not found:", "${name}", "\\n")\n` +
    '} else {\n' +
    `  .v <- get("${name}", envir=.GlobalEnv)\n` +
    '  cat(paste(class(.v), collapse=","), "\\n")\n' +
    '  if (!is.null(dim(.v))) cat("dim", paste(dim(.v), collapse="x"), "\\n")\n' +
    '  print(.v)\n' +
    '}\n'
  );
}

async function getJson(url: string, token: string, init?: RequestInit): Promise<unknown> {
  const headers: Record<string, string> = token ? { Authorization: `token ${token}` } : {};
  if (init?.headers) {
    Object.assign(headers, init.headers as Record<string, string>);
  }
  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

// Two RTC backends, same room-id scheme, different fileId lookup: plain
// jupyter-collaboration's session endpoint 404s under jupyter_server_documents
// (Jupyter AI's newer backend), which resolves fileId via /api/fileid/index
// instead and ignores sessionId entirely.
async function resolveCollaborationRoom(
  serverUrl: string,
  token: string,
  path: string
): Promise<{ wsBase: string; roomId: string; sessionId: string }> {
  const base = serverUrl.replace(/\/+$/, '');
  const cleanPath = path.replace(/^\/+/, '');
  const wsBase = `${base.replace(/^http/, 'ws')}/api/collaboration/room`;
  const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/');

  try {
    const raw = (await getJson(`${base}/api/collaboration/session/${encodedPath}`, token, {
      method: 'PUT',
      body: JSON.stringify({ format: 'json', type: 'notebook' }),
      headers: { 'Content-Type': 'application/json' },
    })) as { format: string; type: string; fileId: string; sessionId: string };
    return { wsBase, roomId: `${raw.format}:${raw.type}:${raw.fileId}`, sessionId: raw.sessionId };
  } catch (e) {
    if (!(e instanceof Error) || e.message !== 'HTTP 404') {
      throw e;
    }
  }

  const raw = (await getJson(`${base}/api/fileid/index`, token, {
    method: 'POST',
    body: `path=${encodeURIComponent(cleanPath)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })) as { id: string; path: string };
  return { wsBase, roomId: `json:notebook:${raw.id}`, sessionId: '' };
}

export interface ConnectOptions {
  kernelName?: string;
  // The full /api/sessions entry for an already-open notebook (from
  // discovery.ts's resolveConnection): attach to it instead of starting a
  // duplicate kernel.
  sessionModel?: JupyterSession;
}

export class JupyterLabSession {
  readonly path: string;
  private serverSettings: ServerConnection.ISettings;
  private sessionConnection!: Session.ISessionConnection;
  private provider!: WebsocketProvider;
  private ynotebook!: YNotebook;
  // Drives which introspection snippet `listVariables`/`inspectVariable` run.
  // Best-effort, defaults to 'python'. Detected lazily: see `_detectLanguage()`.
  private language = 'python';
  private _languageDetected = false;

  private constructor(path: string, serverSettings: ServerConnection.ISettings) {
    this.path = path;
    this.serverSettings = serverSettings;
  }

  static async connect(
    serverUrl: string,
    token: string,
    notebookPath: string,
    options: ConnectOptions = {},
    readyTimeoutMs = 30000
  ): Promise<JupyterLabSession> {
    const wsUrl = serverUrl.replace(/^http/, 'ws');
    const serverSettings = ServerConnection.makeSettings({ baseUrl: serverUrl, wsUrl, token });
    const session = new JupyterLabSession(notebookPath, serverSettings);
    try {
      await session.init(options.kernelName ?? 'python3', options.sessionModel, readyTimeoutMs);
    } catch (e) {
      await session.shutdown();
      throw e;
    }
    return session;
  }

  private async init(
    kernelName: string,
    sessionModel: JupyterSession | undefined,
    readyTimeoutMs: number
  ): Promise<void> {
    const kernelManager = new KernelManager({ serverSettings: this.serverSettings });
    const sessionManager = new SessionManager({ serverSettings: this.serverSettings, kernelManager });
    if (sessionModel) {
      // Session.IModel requires id/name fields not present in our JupyterSession slice.
      this.sessionConnection = sessionManager.connectTo({ model: sessionModel as any });
    } else {
      // ISessionOptions requires a `kernel` field that @jupyterlab/services' own
      // startNew actually accepts as optional at runtime — the types are too strict.
      this.sessionConnection = await sessionManager.startNew({
        path: this.path,
        type: 'notebook',
        name: kernelName,
        kernel: { name: kernelName },
      } as any);
    }
    const { wsBase, roomId, sessionId } = await resolveCollaborationRoom(
      this.serverSettings.baseUrl,
      this.serverSettings.token,
      this.path
    );
    this.ynotebook = new YNotebook();
    const params: Record<string, string> = { sessionId };
    if (this.serverSettings.token) {
      params.token = this.serverSettings.token;
    }
    this.provider = new WebsocketProvider(wsBase, roomId, this.ynotebook.ydoc, { params });
    await this._waitForSync(readyTimeoutMs);
  }

  private _waitForSync(readyTimeoutMs: number): Promise<void> {
    // Bounded: a missing/locked document must fail loud, never hang the
    // agent's tool call waiting for an RTC sync that will never arrive.
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('RTC sync timed out')), readyTimeoutMs);
      const onSync = (isSynced: boolean) => {
        if (isSynced) {
          clearTimeout(timer);
          this.provider.off('sync', onSync);
          resolve();
        }
      };
      this.provider.on('sync', onSync);
    });
  }

  // Lazy, not part of init(): @jupyterlab/services' KernelConnection sends
  // its own internal kernel_info_request the moment the websocket reaches
  // 'connected' (confirmed by reading default.js's _updateConnectionStatus),
  // and queues every other outgoing message until that resolves. Calling
  // requestKernelInfo() ourselves right after connecting raced that
  // handshake and left subsequent requestExecute() calls stuck in the
  // pending-message queue forever: reproduced live (kernel stayed 'idle'
  // forever, no error, no IOPub). Deferring this until the first
  // listVariables/inspectVariable call (well after the connection has
  // settled) sidesteps the race entirely, and most sessions never call
  // either, so it's also strictly fewer kernel round-trips.
  private async _detectLanguage(): Promise<void> {
    if (this._languageDetected) {
      return;
    }
    this._languageDetected = true;
    try {
      const reply = await this.kernel?.requestKernelInfo();
      // IInfoReply is typed as an opaque interface; language_info lives in content
      // at runtime but isn't exposed at the top level in the TS declarations.
      const name = (reply?.content as any)?.language_info?.name;
      if (name) {
        this.language = String(name).toLowerCase();
      }
    } catch {
      /* best effort: language stays 'python' */
    }
  }

  get kernel(): Kernel.IKernelConnection | null {
    return this.sessionConnection.kernel;
  }

  // ---- live edits (appear in the user's tab immediately) ----
  addCodeCell(source: string): number {
    this.ynotebook.addCell({ cell_type: 'code', source, metadata: {} });
    return this.ynotebook.cells.length - 1;
  }

  addMarkdownCell(source: string, index?: number): number {
    if (index !== undefined) {
      this.ynotebook.insertCell(index, { cell_type: 'markdown', source, metadata: {} });
      return index;
    }
    this.ynotebook.addCell({ cell_type: 'markdown', source, metadata: {} });
    return this.ynotebook.cells.length - 1;
  }

  editCell(index: number, source: string): void {
    (this.ynotebook.getCell(index) as any).setSource(source);
  }

  deleteCell(index: number): void {
    this.ynotebook.deleteCell(index);
  }

  // ---- execution (outputs render below the cell in the tab) ----
  private async _drainExecute(
    code: string,
    timeoutMs: number
  ): Promise<{ outputs: CellOutput[]; executionCount: number | null; error: string | null }> {
    const kernel = this.kernel;
    if (!kernel) {
      throw new Error('no kernel attached to this session');
    }
    const future = kernel.requestExecute({ code });
    const outputs: CellOutput[] = [];
    let error: string | null = null;
    future.onIOPub = (msg) => {
      const msgType = msg.header.msg_type;
      const content: any = msg.content;
      if (msgType === 'stream') {
        outputs.push({ kind: 'stream', data: { name: content.name, text: content.text } });
      } else if (msgType === 'execute_result' || msgType === 'display_data') {
        outputs.push({ kind: msgType, data: content.data });
      } else if (msgType === 'error') {
        error = content.ename ?? null;
        outputs.push({
          kind: 'error',
          data: { ename: content.ename, evalue: content.evalue, traceback: content.traceback },
        });
      }
    };
    const reply = await Promise.race([
      future.done,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('execution timed out')), timeoutMs)
      ),
    ]);
    const executionCount = (reply as any).content.execution_count ?? null;
    return { outputs, executionCount, error };
  }

  async executeCell(index: number, timeoutMs = 120000): Promise<void> {
    const cell = this.ynotebook.getCell(index) as any; // YCodeCell
    const { outputs, executionCount, error } = await this._drainExecute(cell.getSource(), timeoutMs);
    cell.setOutputs(toNbOutputs({ source: '', outputs, executionCount, error, cellType: 'code' }) as any);
    cell.setExecutionCount(executionCount);
  }

  async addAndExecute(source: string, timeoutMs = 120000): Promise<number> {
    const index = this.addCodeCell(source);
    await this.executeCell(index, timeoutMs);
    return index;
  }

  // ---- read full context ----

  cells(): Cell[] {
    return cellsFromNb(this.ynotebook.toJSON() as any);
  }

  // ---- kernel introspection / lifecycle ----

  async listVariables(): Promise<Record<string, unknown>> {
    await this._detectLanguage();
    const snippet = this.language === 'python' ? INSPECT_PY : this.language === 'r' ? INSPECT_R : null;
    if (!snippet) {
      return {};
    }
    const { outputs } = await this._drainExecute(snippet, 30000);
    for (const o of outputs) {
      if (o.kind === 'stream') {
        const text: string = o.data.text ?? '';
        const markerAt = text.indexOf(VARS_MARKER);
        if (markerAt !== -1) {
          const payload = text.slice(markerAt + VARS_MARKER.length).trim();
          try {
            return payload ? JSON.parse(payload) : {};
          } catch {
            return {};
          }
        }
      }
    }
    return {};
  }

  async inspectVariable(name: string): Promise<string> {
    await this._detectLanguage();
    const src = this.language === 'r' ? showRSnippet(name) : showPySnippet(name);
    const { outputs, executionCount, error } = await this._drainExecute(src, 30000);
    return renderForAgent({ source: src, outputs, executionCount, error, cellType: 'code' });
  }

  async saveNotebook(): Promise<void> {
    const base = this.serverSettings.baseUrl.replace(/\/+$/, '');
    const token = this.serverSettings.token;
    const encoded = encodeURIComponent(this.path.replace(/^\/+/, ''));
    const body = JSON.stringify({
      type: 'notebook',
      format: 'json',
      content: this.ynotebook.toJSON(),
    });
    const res = await fetch(`${base}/api/contents/${encoded}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `token ${token}`,
      },
      body,
    });
    if (!res.ok) throw new Error(`save failed: ${res.status} ${res.statusText}`);
  }

  clearNotebook(): number {
    const count = this.ynotebook.cells.length;
    // Delete from the end to avoid index shifting.
    for (let i = count - 1; i >= 0; i--) {
      this.ynotebook.deleteCell(i);
    }
    return count;
  }

  async restartKernel(): Promise<void> {
    const kernel = this.kernel;
    if (!kernel) {
      throw new Error('no kernel attached to this session');
    }
    await kernel.restart();
  }

  async shutdown(): Promise<void> {
    try {
      this.provider?.destroy();
    } catch {
      /* best effort */
    }
    try {
      this.ynotebook?.dispose();
    } catch {
      /* best effort */
    }
    try {
      this.sessionConnection?.dispose();
    } catch {
      /* best effort */
    }
  }
}
