// Connection resolution for the JupyterLab adapter. Lemma never discovers
// a running Jupyter server itself: server_url/token must be supplied
// explicitly by the caller.
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

export class NoServerFound extends Error {}
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

export async function notebookExists(server: JupyterServer, path: string): Promise<boolean> {
  try {
    await getJson(`${server.url}/api/contents/${encodeURIComponent(path.replace(/^\/+/, ''))}?content=0`, server.token);
    return true;
  } catch {
    return false;
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
      kernelName: match?.kernel?.name,
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
