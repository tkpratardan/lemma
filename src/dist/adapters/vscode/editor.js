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
export class Editor {
    bridge;
    constructor(bridge) {
        this.bridge = bridge;
    }
    async req(method, route, notebookPath, payload, timeoutMs = TIMEOUT_MS) {
        const qs = notebookPath ? `?path=${encodeURIComponent(notebookPath)}` : '';
        const res = await fetch(this.bridge.url + route + qs, {
            method,
            headers: { 'x-lemma-token': this.bridge.token, 'Content-Type': 'application/json' },
            body: payload !== undefined ? JSON.stringify(payload) : undefined,
            signal: timeoutMs === null ? undefined : AbortSignal.timeout(timeoutMs),
        });
        const body = await res.json();
        if (!res.ok) {
            throw new Error(String(body?.['error'] ?? `HTTP ${res.status}`));
        }
        return body;
    }
    health() {
        return this.req('GET', '/health');
    }
    open() {
        return this.req('GET', '/open');
    }
    read(path) {
        return this.req('GET', '/read', path);
    }
    state(path) {
        return this.req('GET', '/state', path);
    }
    execute(path, code) {
        return this.req('POST', '/execute', path, { code }, CONFIRM_TIMEOUT_MS);
    }
    addAndRun(path, source, index) {
        return this.req('POST', '/add_and_run', path, index !== undefined ? { source, index } : { source }, CONFIRM_TIMEOUT_MS);
    }
    run(path, index) {
        return this.req('POST', '/run', path, { index });
    }
    runAll(path) {
        return this.req('POST', '/run_all', path, {}, RUN_ALL_TIMEOUT_MS);
    }
    edit(path, index, source) {
        return this.req('POST', '/edit', path, { index, source }, CONFIRM_TIMEOUT_MS);
    }
    editAndRun(path, index, source) {
        return this.req('POST', '/edit_and_run', path, { index, source }, CONFIRM_TIMEOUT_MS);
    }
    insert(path, index, source) {
        return this.req('POST', '/insert', path, { index, source }, CONFIRM_TIMEOUT_MS);
    }
    delete(path, index) {
        return this.req('POST', '/delete', path, { index }, CONFIRM_TIMEOUT_MS);
    }
    markdown(path, source, index) {
        return this.req('POST', '/markdown', path, index !== undefined ? { source, index } : { source }, CONFIRM_TIMEOUT_MS);
    }
    output(path, index) {
        return this.req('POST', '/output', path, { index });
    }
    restart(path) {
        return this.req('POST', '/restart', path);
    }
    inspect(path, name) {
        return this.req('POST', '/inspect', path, { name });
    }
    probe(path, code) {
        return this.req('POST', '/probe', path, { code });
    }
    clear(path) {
        return this.req('POST', '/clear', path);
    }
    save(path) {
        return this.req('POST', '/save', path);
    }
}
// All advertised editor bridges, newest first by discovery-file mtime.
// One file per editor process (pid in the name) so multiple open windows
// don't clobber each other.
export function discoverBridges() {
    let files;
    try {
        files = fs
            .readdirSync(DISCOVERY_DIR)
            .filter((f) => f.startsWith('vscode-') && f.endsWith('.json'))
            .map((f) => path.join(DISCOVERY_DIR, f));
    }
    catch {
        return [];
    }
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    const bridges = [];
    for (const f of files) {
        try {
            const d = JSON.parse(fs.readFileSync(f, 'utf8'));
            bridges.push({ url: d.url, token: d.token, pid: Number(d.pid ?? 0) });
        }
        catch {
            continue;
        }
    }
    return bridges;
}
// The newest reachable editor bridge, or null if none is open. Stale
// discovery files (editor killed) are skipped because /health fails.
export async function findEditor() {
    for (const b of discoverBridges()) {
        const ed = new Editor(b);
        try {
            await ed.health();
            return ed;
        }
        catch {
            continue;
        }
    }
    return null;
}
//# sourceMappingURL=editor.js.map