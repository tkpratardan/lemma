#!/usr/bin/env node
// Lemma MCP server (stdio). Exposes a small canonical analysis interface and
// dispatches internally to JupyterLab RTC, the VS Code editor bridge, or
// PyCharm's disk-backed notebook plus kernel client. Legacy verbs are opt-in.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { text } from '../utils/response.js';
import { KernelHttpClient } from '../adapters/kernel-http/client.js';
import {
  createJupyterlabHandlers,
  registerJupyterlabTools,
  shutdownJupyterlabSession,
} from '../adapters/jupyterlab/tools.js';
import { registerVscodeTools } from '../adapters/vscode/tools.js';
import {
  createPyCharmHandlers,
  registerPyCharmTools,
  type PyCharmKernel,
} from '../adapters/pycharm/tools.js';
import { registerNotebookTools } from '../adapters/notebook/tools.js';
import { registerCanonicalTools } from './canonical.js';
import { resolvePreferredSurface } from './surface.js';

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
      description: 'Evidence-based data analysis: inspect sources, compute in the notebook, check correctness, and return the requested result.',
    },
    () => ({
      messages: [{ role: 'user', content: { type: 'text', text: PERSONA } }],
    })
  );
}

const SKILL_NAMES = [
  'lemma-wrangle',
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

const LEGACY_TOOLS = process.env.LEMMA_LEGACY_TOOLS === '1';

const SCRIPTS_BY_SKILL: Partial<Record<(typeof SKILL_NAMES)[number], readonly string[]>> = {
  'lemma-wrangle': ['scripts/source_inventory.py'],
  'lemma-eda': ['scripts/profile_table.py'],
  'lemma-review': ['scripts/notebook_integrity.py', 'scripts/verify_clean_run.py'],
};

function skillResource(
  name: (typeof SKILL_NAMES)[number],
  resource: 'procedure' | 'reference' | 'script'
): string {
  const relatives = resource === 'procedure'
    ? ['SKILL.md']
    : resource === 'reference'
      ? ['references/deep-guide.md']
      : SCRIPTS_BY_SKILL[name];
  if (!relatives) return `skill ${name} has no deterministic script resource.`;
  try {
    return relatives
      .map((relative) => `# ${relative}\n\n${fs.readFileSync(path.join(lemmaRoot(), 'skills', name, relative), 'utf8')}`)
      .join('\n\n');
  } catch {
    return `one or more ${name} ${resource} resources are missing, is the lemma install complete?`;
  }
}

// Progressive-disclosure pull path for hosts with no native skill loader.
// This is an MCP prompt, not a ninth action in the notebook tool interface.
server.registerPrompt(
  'lemma_skill',
  {
    title: 'Load a Lemma procedure or resource',
    description:
      'Load a compact procedure first; request its reference or script only when the procedure calls for it.',
    argsSchema: {
      name: z.enum(SKILL_NAMES),
      resource: z.enum(['procedure', 'reference', 'script']).default('procedure'),
    },
  },
  ({ name, resource }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: skillResource(name, resource) } }],
  })
);

// Migration escape hatch only. The default server has exactly the canonical
// analysis tools; older clients can opt into this auxiliary tool too.
if (LEGACY_TOOLS) {
  server.registerTool(
    'lemma_skill',
    {
      description: 'Returns one compact Lemma procedure for a legacy client with no prompt support.',
      inputSchema: { name: z.enum(SKILL_NAMES) },
    },
    ({ name }) => text(skillResource(name, 'procedure'))
  );
}

const NO_KERNEL = 'No kernel connection.';

// HTTP client set by the PyCharm backend's canonical connect action.
let httpClient: KernelHttpClient | undefined;

type IKernelClient = Pick<KernelHttpClient, 'execute' | 'inspectVariable' | 'restart' | 'kill'>;

function getKernel(): IKernelClient | string {
  return httpClient ?? NO_KERNEL;
}

// --surface=vscode|pycharm|jupyter is only the lazy-attachment preference.
// Every adapter stays registered, and connect(surface=...) may switch at any
// point without changing the stable five-action tool interface.
const preferredSurface = resolvePreferredSurface();

function pycharmKernel(): PyCharmKernel {
  return {
    current: () => getKernel(),
    connect: async ({ serverUrl, token, notebookPath }) => {
      httpClient?.kill();
      httpClient = await KernelHttpClient.connect({ serverUrl, token, notebookPath });
      return { kernelId: httpClient.kernelId };
    },
  };
}

if (LEGACY_TOOLS) {
  registerVscodeTools(server);
  const pycharmHandlers = registerPyCharmTools(server, pycharmKernel());
  const jupyterlabHandlers = registerJupyterlabTools(server);
  registerNotebookTools(server, { pycharm: pycharmHandlers, jupyterlab: jupyterlabHandlers });
} else {
  const pycharmHandlers = createPyCharmHandlers(pycharmKernel());
  const jupyterlabHandlers = createJupyterlabHandlers();
  registerCanonicalTools(server, {
    preferredSurface,
    pycharm: pycharmHandlers,
    jupyterlab: jupyterlabHandlers,
    includeAuditTools: process.env.LEMMA_AUDIT_TOOLS === '1',
  });
}

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
