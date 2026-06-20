// Kernel execution via the Jupyter HTTP/WebSocket API.
// Works with any accessible Jupyter server (Docker-forwarded, remote SSH,
// cloud Jupyter) without ZMQ port access, jupyter-collaboration, or an open
// editor. Uses @jupyterlab/services (already a dep for the jupyterlab adapter)
// for the kernel WebSocket connection and message dispatch.
//
// Env-var defaults, also read directly by jupyterlab_connect:
//   LEMMA_JUPYTER_URL   – server base URL, e.g. http://localhost:12121
//   LEMMA_JUPYTER_TOKEN – auth token; omit for token-less servers
//   LEMMA_KERNEL_ID     – pin to a specific kernel ID; default: most-recently-active
import { KernelManager, ServerConnection } from '@jupyterlab/services';
// Variable-introspection snippet: same approach as jupyterlab/session.ts.
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
function showPySnippet(name) {
    const literal = JSON.stringify(name);
    return ('def _lemma_show(_n):\n' +
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
        `_lemma_show(${literal})\n`);
}
// Resolve which kernel to connect to. Prefers explicit kernelId, then
// notebook path match from the sessions list, then most-recently-active.
async function resolveKernelModel(serverUrl, token, notebookPath, kernelId) {
    const base = serverUrl.replace(/\/+$/, '');
    const headers = token ? { Authorization: `token ${token}` } : {};
    if (kernelId) {
        const res = await fetch(`${base}/api/kernels/${kernelId}`, {
            headers,
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok)
            throw new Error(`kernel ${kernelId} not found: HTTP ${res.status}`);
        const k = await res.json();
        return { id: k.id, name: k.name };
    }
    const res = await fetch(`${base}/api/sessions`, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok)
        throw new Error(`/api/sessions HTTP ${res.status}`);
    const sessions = await res.json();
    if (sessions.length === 0)
        throw new Error('no active sessions on the Jupyter server');
    if (notebookPath) {
        const match = sessions.find((s) => {
            const p = s.notebook?.path ?? s.path ?? '';
            // Accept both "research_amp/foo.ipynb" and a suffix match.
            return p === notebookPath || p.endsWith('/' + notebookPath) || notebookPath.endsWith('/' + p);
        });
        if (!match) {
            const paths = sessions.map((s) => s.notebook?.path ?? s.path ?? '(unknown)').join(', ');
            throw new Error(`no session found for '${notebookPath}'; open sessions: ${paths}`);
        }
        return { id: match.kernel.id, name: match.kernel.name };
    }
    // Most recently active kernel.
    sessions.sort((a, b) => new Date(b.kernel.last_activity ?? 0).getTime() -
        new Date(a.kernel.last_activity ?? 0).getTime());
    const k = sessions[0].kernel;
    return { id: k.id, name: k.name };
}
export class KernelHttpClient {
    kernelId;
    kernel;
    manager;
    constructor(kernel, manager) {
        this.kernel = kernel;
        this.manager = manager;
        this.kernelId = kernel.id;
    }
    static async connect(options) {
        const { serverUrl, token = '', notebookPath, kernelId } = options;
        const wsUrl = serverUrl.replace(/^http/, 'ws');
        const settings = ServerConnection.makeSettings({ baseUrl: serverUrl, wsUrl, token });
        const manager = new KernelManager({ serverSettings: settings });
        const model = await resolveKernelModel(serverUrl, token, notebookPath, kernelId);
        const kernel = manager.connectTo({ model });
        return new KernelHttpClient(kernel, manager);
    }
    async _drainExecute(code, timeoutMs) {
        const future = this.kernel.requestExecute({ code });
        const outputs = [];
        let error = null;
        future.onIOPub = (msg) => {
            const msgType = msg.header.msg_type;
            const content = msg.content;
            if (msgType === 'stream') {
                outputs.push({ kind: 'stream', data: { name: content.name, text: content.text } });
            }
            else if (msgType === 'execute_result' || msgType === 'display_data') {
                outputs.push({ kind: msgType, data: content.data });
            }
            else if (msgType === 'error') {
                error = content.ename ?? null;
                outputs.push({
                    kind: 'error',
                    data: { ename: content.ename, evalue: content.evalue, traceback: content.traceback },
                });
            }
        };
        const reply = await Promise.race([
            future.done,
            new Promise((_, reject) => setTimeout(() => reject(new Error('execution timed out')), timeoutMs)),
        ]);
        const executionCount = reply.content?.execution_count ?? null;
        return { outputs, executionCount, error };
    }
    async execute(code) {
        const { outputs, executionCount, error } = await this._drainExecute(code, 120000);
        return { source: code, outputs, executionCount, error, cellType: 'code' };
    }
    async inspectVariable(name) {
        const src = showPySnippet(name);
        const { outputs, executionCount, error } = await this._drainExecute(src, 30000);
        return { source: src, outputs, executionCount, error, cellType: 'code' };
    }
    async listVariables() {
        const { outputs } = await this._drainExecute(INSPECT_PY, 30000);
        for (const o of outputs) {
            if (o.kind === 'stream') {
                const text = o.data.text ?? '';
                const markerAt = text.indexOf(VARS_MARKER);
                if (markerAt !== -1) {
                    const payload = text.slice(markerAt + VARS_MARKER.length).trim();
                    try {
                        return payload ? JSON.parse(payload) : {};
                    }
                    catch {
                        return {};
                    }
                }
            }
        }
        return {};
    }
    async restart() {
        await this.kernel.restart();
        return { message: 'kernel restarted' };
    }
    // Closes the WebSocket connection; does not kill the server-side kernel
    // (Lemma never owns HTTP-connected kernels: the user started them).
    kill() {
        try {
            this.kernel.dispose();
        }
        catch { /* best effort */ }
        try {
            this.manager.dispose();
        }
        catch { /* best effort */ }
    }
}
//# sourceMappingURL=client.js.map