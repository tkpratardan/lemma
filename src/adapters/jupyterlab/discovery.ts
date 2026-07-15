// Connection resolution for the JupyterLab adapter. server_url/token can be
// passed explicitly, or left out for discoverNotebooks() to find a local
// server itself (only valid when lemma runs colocated with it).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { JupyterSession } from '../../utils/jupyterApi.js';

export interface JupyterServer {
  url: string;
  token: string;
}

export interface Connection {
  url: string;
  token: string;
  notebookPath: string | null;
  kernelId?: string;
  kernelName?: string;
  // The full /api/sessions entry for an already-open notebook, when one
  // exists: @jupyterlab/services' SessionManager.connectTo() needs the
  // whole model (including the session's own id), not just kernelId/Name.
  sessionModel?: JupyterSession;
}

export class ServerUnreachable extends Error {}
export class NotebookNotFound extends Error {}

const APP_SEGMENTS = ['/lab', '/tree', '/notebooks', '/doc'];

// Split a pasted JupyterLab URL into (base_url, token). Accepts whatever
// the user pastes, e.g. http://host:8888/lab/tree/n.ipynb?token=abc, or a
// bare host:port.
export function parseJupyterUrl(raw: string): { base: string; token: string | null } {
  const trimmed = raw.trim();
  const withScheme = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
  const parsed = new URL(withScheme);
  const token = parsed.searchParams.get('token');
  let path = parsed.pathname;
  for (const seg of APP_SEGMENTS) {
    const i = path.indexOf(seg);
    if (i !== -1) {
      path = path.slice(0, i);
      break;
    }
  }
  const base = `${parsed.protocol}//${parsed.host}${path}`.replace(/\/+$/, '');
  return { base, token };
}

async function getJson(url: string, token: string): Promise<any> {
  const headers: Record<string, string> = token ? { Authorization: `token ${token}` } : {};
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function reachable(server: JupyterServer): Promise<boolean> {
  try {
    await getJson(`${server.url}/api/status`, server.token);
    return true;
  } catch {
    return false;
  }
}

function encodeContentsPath(path: string): string {
  return path
    .replace(/^\/+/, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

export async function notebookExists(server: JupyterServer, path: string): Promise<boolean> {
  try {
    await getJson(`${server.url}/api/contents/${encodeContentsPath(path)}?content=0`, server.token);
    return true;
  } catch {
    return false;
  }
}

// A notebook with no live session has no kernel to inherit a name from, but
// it does carry its own preferred kernel in metadata.kernelspec.name (set at
// creation time). Read that so a fresh notebook starts the kernel its author
// intended instead of whatever 'python3' happens to resolve to on this
// machine's shared kernelspec registry.
async function notebookKernelspecName(server: JupyterServer, path: string): Promise<string | undefined> {
  try {
    const content = await getJson(`${server.url}/api/contents/${encodeContentsPath(path)}?content=1`, server.token);
    return content?.content?.metadata?.kernelspec?.name;
  } catch {
    return undefined;
  }
}

export async function listNotebookSessions(server: JupyterServer): Promise<JupyterSession[]> {
  let sessions: JupyterSession[];
  try {
    sessions = await getJson(`${server.url}/api/sessions`, server.token);
  } catch {
    return [];
  }
  const notebooks = sessions.filter((s) => s.type === 'notebook' && s.path);
  notebooks.sort((a, b) => {
    const aTime = a.kernel?.last_activity ?? '';
    const bTime = b.kernel?.last_activity ?? '';
    return aTime < bTime ? 1 : aTime > bTime ? -1 : 0;
  });
  return notebooks;
}

function selectServer(serverUrl: string, token?: string): JupyterServer {
  const { base, token: urlToken } = parseJupyterUrl(serverUrl);
  return { url: base, token: token ?? urlToken ?? '' };
}

// Fill in whatever wasn't supplied by resolving it against the (already
// known) server. If the chosen notebook has a live session, its kernel_id
// is returned too, so the caller attaches to the user's running kernel
// instead of starting a duplicate.
export async function resolveConnection(
  serverUrl: string,
  token?: string,
  notebookPath?: string
): Promise<Connection> {
  const server = selectServer(serverUrl, token);
  if (!(await reachable(server))) {
    throw new ServerUnreachable(
      `could not reach a Jupyter server at ${server.url}: check the URL is reachable and the ` +
        'token is valid. Auth is token-only: a token-protected server needs its token; for ' +
        'JupyterHub use a Hub API token (Control Panel → Token) with your user-server URL; ' +
        'password/cookie-session login is not supported.'
    );
  }
  const sessions = await listNotebookSessions(server);
  if (notebookPath) {
    const match = sessions.find((s) => s.path === notebookPath);
    if (!match && !(await notebookExists(server, notebookPath))) {
      throw new NotebookNotFound(
        `notebook '${notebookPath}' was not found on ${server.url}. Create it (or open it) in ` +
          'JupyterLab first, then reconnect.'
      );
    }
    return {
      url: server.url,
      token: server.token,
      notebookPath,
      kernelId: match?.kernel?.id,
      kernelName: match?.kernel?.name ?? (await notebookKernelspecName(server, notebookPath)),
      sessionModel: match,
    };
  }
  // No specific notebook requested: pick the most recently active open one.
  // TODO: This is not correct. We should not connect to notebook other than the one specified. 
  if (sessions.length === 0) {
    return { url: server.url, token: server.token, notebookPath: null };
  }
  const top = sessions[0];
  return {
    url: server.url,
    token: server.token,
    notebookPath: top.path ?? null,
    kernelId: top.kernel?.id,
    kernelName: top.kernel?.name,
    sessionModel: top,
  };
}

function runtimeDirs(): string[] {
  if (process.env.JUPYTER_RUNTIME_DIR) {
    return [process.env.JUPYTER_RUNTIME_DIR];
  }
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return [path.join(home, 'Library', 'Jupyter', 'runtime')];
  }
  if (process.platform === 'win32') {
    return [path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'jupyter', 'runtime')];
  }
  const dirs = [];
  if (process.env.XDG_RUNTIME_DIR) {
    dirs.push(path.join(process.env.XDG_RUNTIME_DIR, 'jupyter'));
  }
  dirs.push(path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'jupyter', 'runtime'));
  return dirs;
}

function localServers(): JupyterServer[] {
  const found: JupyterServer[] = [];
  for (const dir of runtimeDirs()) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/^(jp|nb)server-.*\.json$/.test(name)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (data.url) found.push({ url: String(data.url).replace(/\/+$/, ''), token: data.token ?? '' });
      } catch {
        continue;
      }
    }
  }
  return found;
}

export interface DiscoveredNotebook {
  server: JupyterServer;
  notebookPath: string;
  kernelId?: string;
  kernelName?: string;
  sessionModel?: JupyterSession;
}

// One-shot local lookup so the agent doesn't need to probe `jupyter server
// list` + status + sessions itself. Only meaningful when lemma runs
// colocated with the server.
export async function discoverNotebooks(): Promise<DiscoveredNotebook[]> {
  const results: DiscoveredNotebook[] = [];
  for (const server of localServers()) {
    if (!(await reachable(server))) continue;
    for (const s of await listNotebookSessions(server)) {
      if (!s.path) continue;
      results.push({
        server,
        notebookPath: s.path,
        kernelId: s.kernel?.id,
        kernelName: s.kernel?.name,
        sessionModel: s,
      });
    }
  }
  return results;
}
