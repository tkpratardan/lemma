// lemma — OpenCode plugin. The single persona channel on this host: injects
// AGENTS.md into every request's system prompt (rebuilt per request, so a
// flat cost — nothing accumulates in the transcript) and provides the
// `/lemma [on|off]` mode switch. The installer writes no `instructions`
// entry and suppresses the MCP instructions copy, so nothing is delivered
// twice.
//
// Reuses hooks/lib/instructions.js (CommonJS) as the single source of truth
// for the persona text, same as hooks/session-start.js does for Claude Code —
// one ruleset, multiple hosts, no copy to drift.
//
// Add to opencode.json:
//   { "plugin": ["./.opencode/plugins/lemma.mjs"] }

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { getFullPersona } = require('../../hooks/lib/instructions.js');
const { setDiscarded, isDiscarded, clearDiscarded, isDiscardSignal } = require('../../hooks/lib/discardGate.js');

const STOP_MESSAGE = 'discarded';

// OpenCode has no flag-file convention of its own; keep mode beside its config.
const statePath = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'opencode',
  '.lemma-off',
);

// AGENTS.md: "Active every step ... Off only on 'stop lemma mode'." Default
// is on; the flag file is the only way to turn it off — no intermediate levels.
function isOff() {
  try { return fs.readFileSync(statePath, 'utf8').trim() === 'off'; } catch { return false; }
}

function setOff(off) {
  if (off) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, 'off');
  } else {
    try { fs.unlinkSync(statePath); } catch { /* already on */ }
  }
}

export default async ({ client } = {}) => {
  const log = (level, message) => {
    try { client && client.app && client.app.log({ body: { service: 'lemma', level, message } }); } catch { /* best-effort */ }
  };

  const lemmaSkillsDir = path.resolve(__dirname, '../../skills');

  return {
    // Register slash commands + skills directory.
    config: async (config) => {
      if (!config.command) config.command = {};
      const commandDir = path.join(__dirname, '..', 'command');
      try {
        for (const file of fs.readdirSync(commandDir).filter((f) => f.endsWith('.md'))) {
          const name = path.basename(file, '.md');
          const content = fs.readFileSync(path.join(commandDir, file), 'utf8');
          const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
          if (!match) continue;
          const description = match[1].match(/description:\s*(.+)/)?.[1]?.trim();
          config.command[name] = { description, template: match[2].trim() };
        }
      } catch { /* command dir missing — plugin still works without it */ }

      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(lemmaSkillsDir)) {
        config.skills.paths.push(lemmaSkillsDir);
      }
    },

    'experimental.chat.system.transform': async (_input, output) => {
      clearDiscarded(); // a new turn ends the discard pause
      if (isOff()) return;
      const persona = getFullPersona();
      if (persona) output.system.push('[lemma — data-scientist mode active]\n\n' + persona);
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

    // Persist `/lemma [on|off]` so the next turn's injection follows it.
    // Applies from the next message, not the current one — the transform
    // reads the flag the command writes.
    'command.execute.before': async (input) => {
      if (!input || input.command !== 'lemma') return;
      const arg = (input.arguments || '').trim().toLowerCase();
      if (arg === 'off') {
        setOff(true);
        log('info', 'lemma off');
      } else if (arg === 'on' || arg === '') {
        setOff(false);
        log('info', 'lemma on');
      }
    },
  };
};
