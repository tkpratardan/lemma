// lemma — OpenCode plugin. The single persona channel on this host: injects
// AGENTS.md into every request's system prompt (rebuilt per request, so a
// flat cost—nothing accumulates in the transcript). The installer writes no
// `instructions` entry and suppresses the MCP instructions copy, so nothing
// is delivered twice.
//
// Reuses hooks/lib/instructions.js (CommonJS) as the single source of truth
// for the persona text, same as hooks/session-start.js does for Claude Code —
// one ruleset, multiple hosts, no copy to drift.
//
// Add to opencode.json:
//   { "plugin": ["./.opencode/plugins/lemma.mjs"] }

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { getFullPersona } = require('../../hooks/lib/instructions.js');
const { setDiscarded, isDiscarded, clearDiscarded, isDiscardSignal } = require('../../hooks/lib/discardGate.js');

const STOP_MESSAGE = 'discarded';

export default async ({ client } = {}) => {
  const lemmaSkillsDir = path.resolve(__dirname, '../../skills');

  return {
    // Register the skills directory; analytical skill choice remains with the model.
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(lemmaSkillsDir)) {
        config.skills.paths.push(lemmaSkillsDir);
      }
    },

    'experimental.chat.system.transform': async (_input, output) => {
      clearDiscarded(); // a new turn ends the discard pause
      const persona = getFullPersona();
      if (persona) output.system.push('[lemma: data-science rigor]\n\n' + persona);
    },

    'tool.execute.before': async () => {
      if (isDiscarded()) throw new Error(STOP_MESSAGE);
    },

    'tool.execute.after': async (input, output) => {
      if (isDiscardSignal(output?.output)) {
        setDiscarded();
        try { await client?.session?.abort({ path: { id: input.sessionID } }); } catch { /* best-effort */ }
      }
    },
  };
};
