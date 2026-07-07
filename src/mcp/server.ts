#!/usr/bin/env node
// Lemma MCP server (stdio). Registers jupyterlab_* (RTC live-edit), vscode_*
// (editor bridge), and pycharm_* (read-modify-write the .ipynb on disk, via
// the shared kernel-http client; PyCharm reloads on change).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { text } from '../utils/response.js';
import { KernelHttpClient } from '../adapters/kernel-http/client.js';
import { registerJupyterlabTools, shutdownJupyterlabSession } from '../adapters/jupyterlab/tools.js';
import { registerVscodeTools } from '../adapters/vscode/tools.js';
import { registerPyCharmTools } from '../adapters/pycharm/tools.js';
import { registerNotebookTools } from '../adapters/notebook/tools.js';

// Duplicated from hooks/lib/instructions.js's getFullPersona(): this package
// compiles separately from the plain-Node hooks/ scripts, not worth reaching
// across that boundary for a five-line file read.
function lemmaRoot(): string {
  if (process.env.CLAUDE_PLUGIN_ROOT) return process.env.CLAUDE_PLUGIN_ROOT;
  if (process.env.PLUGIN_ROOT) return process.env.PLUGIN_ROOT;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'AGENTS.md'))) return dir;
    dir = path.dirname(dir);
  }
  return path.dirname(fileURLToPath(import.meta.url));
}

function readPersona(): string | undefined {
  try {
    return fs.readFileSync(path.join(lemmaRoot(), 'AGENTS.md'), 'utf8').trim();
  } catch {
    return undefined;
  }
}

const PERSONA = readPersona();

// LEMMA_NO_MCP_INSTRUCTIONS is set by the installer for hosts whose bundle
// already delivers the persona natively (Copilot session-start hook, Gemini
// contextFileName, opencode plugin).
const SEND_INSTRUCTIONS = PERSONA && !process.env.LEMMA_NO_MCP_INSTRUCTIONS;

const server = new McpServer(
  { name: 'lemma', version: '0.1.0' },
  SEND_INSTRUCTIONS ? { instructions: PERSONA } : undefined
);

// Fallback alongside `instructions`: not every MCP client surfaces
// `initialize.instructions`, but every client can list/fetch a prompt.
if (PERSONA) {
  server.registerPrompt(
    'lemma_persona',
    {
      title: 'Lemma data-scientist persona',
      description: 'Senior data-scientist mode: frame, look, leakage-check, baseline, validate honestly.',
    },
    () => ({
      messages: [{ role: 'user', content: { type: 'text', text: PERSONA } }],
    })
  );
}

const SKILL_NAMES = [
  'lemma-eda',
  'lemma-baseline',
  'lemma-model',
  'lemma-describe',
  'lemma-inference',
  'lemma-causal',
  'lemma-unsupervised',
  'lemma-leakage',
  'lemma-review',
] as const;

// Pull path for the mode rulesets on hosts with no native skill support
// (VS Code, Windsurf, Claude Desktop): AGENTS.md's routing table names
// these skills, and this tool is how such hosts fetch one.
server.registerTool(
  'lemma_skill',
  {
    description:
      "Returns one lemma skill's full ruleset. Invoke before the matching analysis on a host " +
      'with no native skill support.',
    inputSchema: { name: z.enum(SKILL_NAMES) },
  },
  ({ name }) => {
    try {
      return text(fs.readFileSync(path.join(lemmaRoot(), 'skills', name, 'SKILL.md'), 'utf8'));
    } catch {
      return text(`skill ${name} not found, is the lemma install complete?`);
    }
  }
);

const NO_KERNEL = 'No kernel connection.';

// HTTP client, set by pycharm_connect. Shared with PyCharm's tools so
// pycharm_* and a future kernel-backed surface would hit one kernel.
let httpClient: KernelHttpClient | undefined;

type IKernelClient = Pick<KernelHttpClient, 'execute' | 'inspectVariable' | 'restart' | 'kill'>;

function getKernel(): IKernelClient | string {
  return httpClient ?? NO_KERNEL;
}

// --surface=vscode|pycharm|jupyter, written into that host's launch config by
// `lemma --configure <surface>` (bin/install.js), narrows registration to one
// surface. Decided once here at spawn and never toggled at runtime, so
// there's no tools/list_changed for a client to miss.
const surfaceArg = process.argv.find((a) => a.startsWith('--surface='))?.slice('--surface='.length);

if (!surfaceArg || surfaceArg === 'vscode') {
  registerVscodeTools(server);
}

// PyCharm path is disk-backed (no IDE plugin): edits write the .ipynb, execution
// shares this server's kernel client.
const pycharmHandlers = !surfaceArg || surfaceArg === 'pycharm'
  ? registerPyCharmTools(server, {
      current: () => getKernel(),
      connect: async ({ serverUrl, token, notebookPath }) => {
        httpClient?.kill();
        httpClient = await KernelHttpClient.connect({ serverUrl, token, notebookPath });
        return { kernelId: httpClient.kernelId };
      },
    })
  : undefined;

const jupyterlabHandlers = !surfaceArg || surfaceArg === 'jupyter'
  ? registerJupyterlabTools(server)
  : undefined;

registerNotebookTools(server, { pycharm: pycharmHandlers, jupyterlab: jupyterlabHandlers });

function cleanup(): void {
  httpClient?.kill();
  shutdownJupyterlabSession();
}
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
