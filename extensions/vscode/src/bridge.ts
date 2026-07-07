// Local HTTP bridge: lets an *external* MCP agent (Claude Code, Cursor chat,
// Windsurf …) drive the notebook open in THIS editor. Edits go through
// vscode.NotebookEdit (live, in-memory, no disk write), so there's no "file
// changed on disk" conflict from a separate process rewriting the .ipynb.
//
// Stdlib `http` only (no deps). Bound to 127.0.0.1 and gated by a per-session
// token written to a discovery file, so only a local process that can read
// the user's home dir can reach it.
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import * as nb from './notebook';
import { formatCellDiff } from '../../../src/utils/diff.js';
import { errorMessage } from '../../../src/utils/errors.js';

const DISCOVERY_DIR = path.join(os.homedir(), '.lemma');

// One discovery file per editor process (pid in the name), so multiple open
// windows don't clobber each other. Stale files from killed editors are skipped
// by the client (unreachable entries fall through).
function discoveryPath(): string {
  return path.join(DISCOVERY_DIR, `vscode-${process.pid}.json`);
}

type Handler = (body: any, doc: vscode.NotebookDocument) => Promise<unknown> | unknown;

// Diff-view confirmation, gated by the `lemma.confirmEdits` setting: shows
// old vs new cell source and blocks on Accept/Discard before a mutation
// takes effect. The buttons render on the editor title bar and the status
// bar, not in a notification box — a modal would sit over the very diff it
// asks about. Pins each edit to the cell the user actually sees, so a
// misresolved index gets caught before it sticks.
const diffContent = new Map<string, string>();
const disposables: vscode.Disposable[] = [];

// "Always Allow": in-memory only, so it resets on window reload rather than
// touching the `lemma.confirmEdits` setting.
let sessionAllowAll = false;

type Decision = 'accept' | 'always' | 'discard';

// One resolver per open confirm, keyed by the nonce in the lemma-diff URIs,
// so concurrent confirms each answer their own diff tab.
const pendingConfirms = new Map<string, (decision: Decision) => void>();

// `lemma-diff://new/<nonce>.py` → `<nonce>`.
function nonceOf(uri: vscode.Uri): string {
  return uri.path.replace(/^\//, '').replace(/\.[^.]+$/, '');
}

// Handler for the Accept / Always Allow / Discard buttons. Editor-title and
// status-bar invocations pass the diff resource URI; a bare command-palette
// invocation falls back to the active tab's diff input.
function resolveConfirm(uri: vscode.Uri | undefined, decision: Decision): void {
  let nonce = uri && uri.scheme === 'lemma-diff' ? nonceOf(uri) : undefined;
  if (nonce === undefined) {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputTextDiff && input.modified.scheme === 'lemma-diff') {
      nonce = nonceOf(input.modified);
    }
  }
  if (nonce !== undefined) {
    pendingConfirms.get(nonce)?.(decision);
  }
}

// The in-window half of the gate. Not CodeLens: VS Code disables CodeLens
// computation inside diff editors unless the user flips the global
// diffEditor.codeLens setting (microsoft/vscode#97640), which a per-extension
// gate shouldn't do. The status bar is a separate surface, unaffected by that.
let statusBarItems: vscode.StatusBarItem[] = [];

// Left-aligned + high priority anchors these at the bar's true left edge
// (further out than even git branch, ~100000), which survives narrowing;
// Right-aligned at high priority sits by the shrinking middle gap instead.
const STATUS_BAR_BASE_PRIORITY = 1_000_000;

// backgroundColor only accepts errorBackground/warningBackground (VS Code
// restricts it to those two), so Discard uses that; color (foreground) has
// no such restriction, so Accept gets a real green via a semantic ThemeColor.
function showConfirmStatusBar(uri: vscode.Uri): void {
  const spec: Array<[string, string, string, vscode.ThemeColor | undefined, vscode.ThemeColor | undefined]> = [
    ['$(check) Accept', 'lemma.acceptEdit', 'Accept this AI edit', new vscode.ThemeColor('testing.iconPassed'), undefined],
    ['$(check-all) Always Allow', 'lemma.alwaysAllowEdits', 'Always allow AI edits (this session)', undefined, undefined],
    ['$(close) Discard', 'lemma.discardEdit', 'Discard this AI edit', undefined, new vscode.ThemeColor('statusBarItem.errorBackground')],
  ];
  statusBarItems = spec.map(([text, command, tooltip, color, background], i) => {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, STATUS_BAR_BASE_PRIORITY - i);
    item.text = text;
    item.tooltip = tooltip;
    item.color = color;
    item.backgroundColor = background;
    item.command = { command, title: tooltip, arguments: [uri] };
    item.show();
    return item;
  });
}

function hideConfirmStatusBar(): void {
  for (const item of statusBarItems.splice(0)) {
    item.dispose();
  }
}

// Resolves when the diff tab closes (treated as Discard). Returns the
// subscription too, so it can be disposed even when a button click wins
// the race instead of a tab close.
function waitForDiffTabClosed(
  oldUri: vscode.Uri,
  newUri: vscode.Uri
): { promise: Promise<undefined>; dispose: () => void } {
  let sub: vscode.Disposable;
  const promise = new Promise<undefined>((resolve) => {
    sub = vscode.window.tabGroups.onDidChangeTabs((e) => {
      for (const tab of e.closed) {
        const input = tab.input;
        if (
          input instanceof vscode.TabInputTextDiff &&
          (input.original.toString() === oldUri.toString() || input.modified.toString() === newUri.toString())
        ) {
          resolve(undefined);
          return;
        }
      }
    });
  });
  return { promise, dispose: () => sub.dispose() };
}

// Returns true = accepted, false = discarded (caller reverts).
async function confirmEdit(
  label: string,
  oldSource = '',
  newSource = '',
  ext = 'py',
): Promise<boolean> {
  if (sessionAllowAll || !vscode.workspace.getConfiguration('lemma').get<boolean>('confirmEdits', true)) {
    return true;
  }

  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const oldUri = vscode.Uri.parse(`lemma-diff://old/${nonce}.${ext}`);
  const newUri = vscode.Uri.parse(`lemma-diff://new/${nonce}.${ext}`);
  diffContent.set(oldUri.toString(), oldSource);
  diffContent.set(newUri.toString(), newSource);

  const tabClosed = waitForDiffTabClosed(oldUri, newUri);
  try {
    await vscode.commands.executeCommand('vscode.diff', oldUri, newUri, `Lemma: ${label}`);
    showConfirmStatusBar(newUri);
    // Any non-explicit-accept outcome (closed tab) is a Discard.
    const decision = await Promise.race([
      new Promise<Decision>((resolve) => pendingConfirms.set(nonce, resolve)),
      tabClosed.promise,
    ]);
    if (decision === 'always') {
      sessionAllowAll = true;
    }
    const accepted = decision === 'accept' || decision === 'always';

    // Close by URI scheme, not focus, so an unrelated tab is never closed by
    // accident; no-op if the user already closed it (won the race above).
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (
          input instanceof vscode.TabInputTextDiff &&
          (input.original.scheme === 'lemma-diff' || input.modified.scheme === 'lemma-diff')
        ) {
          await vscode.window.tabGroups.close(tab, /* preserveFocus */ true);
          break;
        }
      }
    }
    return accepted;
  } finally {
    hideConfirmStatusBar();
    tabClosed.dispose();
    pendingConfirms.delete(nonce);
    diffContent.delete(oldUri.toString());
    diffContent.delete(newUri.toString());
  }
}

// Wraps the diffed cell's old/new text with unchanged neighbor cells above
// and below, so the confirm-edit view shows where the change sits instead of
// an isolated cell. `prev`/`next` are identical on both diff sides, so they
// render as unchanged context — only `target`'s own lines show as +/-.
function withContext(prev: string, target: string, next: string): string {
  const parts: string[] = [];
  if (prev) parts.push(`# ↑ previous cell (context)\n${prev}`);
  parts.push(target);
  if (next) parts.push(`# ↓ next cell (context)\n${next}`);
  return parts.join('\n\n');
}

// Route table. GET routes ignore the body; POST routes get parsed JSON.
const ROUTES: Record<string, Handler> = {
  'GET /read': (_b, doc) => ({ uri: doc.uri.fsPath, cells: nb.readNotebook(doc) }),
  'GET /state': (_b, doc) => nb.notebookOutline(doc),
  'POST /execute': async (b, doc) => {
    const index = await nb.appendCell(doc, b.code);
    const diff = formatCellDiff('', b.code, `new cell ${index}`);
    const { prev, next } = nb.neighborContext(doc, index);
    if (!await confirmEdit(`add + run cell ${index}`, withContext(prev, '', next), withContext(prev, b.code, next))) {
      await nb.deleteCell(doc, index);
      return { discarded: true, index, diff, output: '' };
    }
    const output = await nb.executeCell(doc, index);
    await nb.revealCell(doc, index);
    return { index, diff, output };
  },
  'POST /add_and_run': async (b, doc) => {
    const at = typeof b.index === 'number'
      ? await nb.insertCell(doc, b.index, b.source)
      : await nb.appendCell(doc, b.source);
    const diff = formatCellDiff('', b.source, `new cell ${at}`);
    const { prev, next } = nb.neighborContext(doc, at);
    if (!await confirmEdit(`add + run cell ${at}`, withContext(prev, '', next), withContext(prev, b.source, next))) {
      await nb.deleteCell(doc, at);
      return { discarded: true, index: at, diff, output: '' };
    }
    const output = await nb.executeCell(doc, at);
    await nb.revealCell(doc, at);
    return { index: at, diff, output };
  },
  'POST /run': async (b, doc) => ({ output: await nb.executeCell(doc, b.index) }),
  'POST /run_all': (_b, doc) => nb.runAllCells(doc),
  'POST /edit': async (b, doc) => {
    const old = cellSource(doc, b.index);
    const { prev, next } = nb.neighborContext(doc, b.index);
    await nb.editCell(doc, b.index, b.source);
    const diff = formatCellDiff(old, b.source, `cell ${b.index}`);
    if (!await confirmEdit(`edited cell ${b.index}`, withContext(prev, old, next), withContext(prev, b.source, next))) {
      await nb.editCell(doc, b.index, old);
      return { discarded: true, diff };
    }
    await nb.revealCell(doc, b.index);
    return { diff };
  },
  'POST /edit_and_run': async (b, doc) => {
    const old = cellSource(doc, b.index);
    const { prev, next } = nb.neighborContext(doc, b.index);
    await nb.editCell(doc, b.index, b.source);
    const diff = formatCellDiff(old, b.source, `cell ${b.index}`);
    if (!await confirmEdit(`edit + run cell ${b.index}`, withContext(prev, old, next), withContext(prev, b.source, next))) {
      await nb.editCell(doc, b.index, old);
      return { discarded: true, diff, output: '' };
    }
    const output = await nb.executeCell(doc, b.index);
    await nb.revealCell(doc, b.index);
    return { diff, output };
  },
  'POST /insert': async (b, doc) => {
    const at = await nb.insertCell(doc, b.index, b.source);
    const diff = formatCellDiff('', b.source, `new cell ${at}`);
    const { prev, next } = nb.neighborContext(doc, at);
    if (!await confirmEdit(`inserted cell ${at}`, withContext(prev, '', next), withContext(prev, b.source, next))) {
      await nb.deleteCell(doc, at);
      return { discarded: true, index: at, diff };
    }
    await nb.revealCell(doc, at);
    return { index: at, diff };
  },
  'POST /delete': async (b, doc) => {
    const removed = cellSource(doc, b.index);
    const ext = doc.cellAt(b.index)?.kind === vscode.NotebookCellKind.Markup ? 'md' : 'py';
    const { prev, next } = nb.neighborContext(doc, b.index);
    await nb.deleteCell(doc, b.index);
    const diff = formatCellDiff(removed, '', `deleted cell ${b.index}`);
    if (!await confirmEdit(`deleted cell ${b.index}`, withContext(prev, removed, next), withContext(prev, '', next), ext)) {
      await nb.insertCell(doc, b.index, removed);
      return { discarded: true, diff };
    }
    await nb.revealCell(doc, b.index);
    return { diff };
  },
  'POST /markdown': async (b, doc) => {
    const at = typeof b.index === 'number'
      ? await nb.insertCell(doc, b.index, b.source, vscode.NotebookCellKind.Markup)
      : await nb.appendCell(doc, b.source, vscode.NotebookCellKind.Markup);
    const diff = formatCellDiff('', b.source, `new markdown cell ${at}`);
    const { prev, next } = nb.neighborContext(doc, at);
    if (!await confirmEdit(`inserted markdown cell ${at}`, withContext(prev, '', next), withContext(prev, b.source, next), 'md')) {
      await nb.deleteCell(doc, at);
      return { discarded: true, index: at, diff };
    }
    await nb.revealCell(doc, at);
    return { index: at, diff };
  },
  'POST /output': (b, doc) => {
    if (typeof b.index !== 'number' || b.index < 0 || b.index >= doc.cellCount) {
      throw new Error(`cell index ${b.index} out of range (0..${doc.cellCount - 1})`);
    }
    const cell = doc.cellAt(b.index);
    return { text: nb.cellOutputText(cell), images: nb.cellImages(cell) };
  },
  'POST /restart': async (_b, doc) => ({ message: await nb.restartKernel(doc) }),
  'POST /inspect': async (b, doc) => ({ output: await nb.inspectVariable(doc, b.name) }),
  'POST /save': async (_b, doc) => ({ saved: await nb.saveNotebook(doc) }),
  'POST /clear': async (_b, doc) => ({ cleared: await nb.clearNotebook(doc) }),
  'POST /probe': async (b, doc) => {
    const index = await nb.appendCell(doc, b.code);
    const output = await nb.executeCell(doc, index);
    await nb.deleteCell(doc, index);
    return { output };
  },
};

function cellSource(doc: vscode.NotebookDocument, index: number): string {
  return index >= 0 && index < doc.cellCount ? doc.cellAt(index).document.getText() : '';
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

// Resolve a caller-given notebook path to an open NotebookDocument, opening
// (and showing) it if it isn't open yet. The caller always names the exact
// notebook it means — no guessing from editor focus, which breaks the
// moment focus is in a chat panel instead of the notebook tab.
async function resolveNotebook(pathStr: string): Promise<vscode.NotebookDocument> {
  const uri = path.isAbsolute(pathStr)
    ? vscode.Uri.file(pathStr)
    : vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file('/'), pathStr);
  const existing = vscode.workspace.notebookDocuments.find((d) => d.uri.toString() === uri.toString());
  if (existing) {
    return existing;
  }
  const doc = await vscode.workspace.openNotebookDocument(uri);
  await vscode.window.showNotebookDocument(doc);
  return doc;
}

export class NotebookBridge {
  private server?: http.Server;
  private token = crypto.randomUUID();

  start(): void {
    disposables.push(
      vscode.workspace.registerTextDocumentContentProvider('lemma-diff', {
        provideTextDocumentContent: (uri) => diffContent.get(uri.toString()) ?? '',
      }),
      vscode.commands.registerCommand('lemma.acceptEdit', (uri?: vscode.Uri) => resolveConfirm(uri, 'accept')),
      vscode.commands.registerCommand('lemma.alwaysAllowEdits', (uri?: vscode.Uri) => resolveConfirm(uri, 'always')),
      vscode.commands.registerCommand('lemma.discardEdit', (uri?: vscode.Uri) => resolveConfirm(uri, 'discard')),
    );
    this.server = http.createServer(async (req, res) => {
      const send = (code: number, obj: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.headers['x-lemma-token'] !== this.token) {
        return send(401, { error: 'bad or missing token' });
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/open') {
        return send(200, { notebooks: vscode.workspace.notebookDocuments.map((d) => d.uri.fsPath) });
      }
      const handler = ROUTES[`${req.method} ${url.pathname}`];
      if (!handler) {
        return send(404, { error: 'no such route' });
      }
      const notebookPath = url.searchParams.get('path');
      if (!notebookPath) {
        return send(400, { error: 'path is required' });
      }
      try {
        const doc = await resolveNotebook(notebookPath);
        const body = req.method === 'POST' ? await readBody(req) : {};
        send(200, await handler(body, doc));
      } catch (e: unknown) {
        send(400, { error: errorMessage(e) });
      }
    });
    // Port 0 → OS picks a free port; the discovery file carries the real one.
    this.server.listen(0, '127.0.0.1', () => this.writeDiscovery());
  }

  private writeDiscovery(): void {
    const addr = this.server!.address();
    if (!addr || typeof addr === 'string') {
      return;
    }
    fs.mkdirSync(DISCOVERY_DIR, { recursive: true });
    fs.writeFileSync(
      discoveryPath(),
      JSON.stringify({ url: `http://127.0.0.1:${addr.port}`, token: this.token, pid: process.pid })
    );
  }

  stop(): void {
    for (const d of disposables.splice(0)) {
      d.dispose();
    }
    this.server?.close();
    try {
      fs.unlinkSync(discoveryPath());
    } catch {
      /* already gone */
    }
  }
}
