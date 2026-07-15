// Per-host output contracts for the shared hook scripts. Each host wants the
// same facts in a different JSON envelope; this table is the one place those
// confirmed shapes live:
//   claude  — nested hookSpecificOutput, trailing newline; SessionStart takes
//             raw stdout as hidden context.
//   codex   — claude's shapes, but SessionStart too needs the JSON envelope
//             or the output is dropped.
//   copilot — flat fields (github.com/en/copilot/reference/hooks-reference);
//             emits nothing on a discard (the gate alone stops the turn).
//   cursor  — flat snake_case permission fields (cursor.com/docs/hooks).
//
// Host comes from --host=<name>; without the flag, PLUGIN_DATA (Codex's own
// plugin-state env var, never set by Claude Code) picks codex over claude —
// hooks.json/codex-hooks.json share commands, so the flag can't carry it
// there.
'use strict';

const json = (obj) => JSON.stringify(obj);

const ENVELOPES = {
  claude: {
    sessionStart: (text) => text,
    deny: (reason = 'discarded') => json({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }) + '\n',
    discardStop: () => json({continue: false, stopReason: 'edit discarded'}) +
        '\n',
    // SubagentStart's raw-stdout form is silently dropped, unlike
    // SessionStart's. Needs the hookSpecificOutput JSON wrapper.
    subagentStart: (text) => json({
      hookSpecificOutput: {
        hookEventName: 'SubagentStart',
        additionalContext: text,
      },
    }) + '\n',
  },
  copilot: {
    sessionStart: (text) => json({additionalContext: text}),
    deny: (reason = 'discarded') => json({
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    }),
    discardStop: () => null,
  },
  cursor: {
    sessionStart: (text) => json({additionalContext: text}),
    deny: (reason = 'discarded') => json({
      permission: 'deny',
      user_message: reason,
      agent_message: reason,
    }),
    discardStop: () => json({
      continue: false,
      permission: 'deny',
      userMessage: 'edit discarded',
      agentMessage: 'edit discarded',
    }),
  },
};
ENVELOPES.codex = {
  ...ENVELOPES.claude,
  sessionStart: (text) => json({
    hookSpecificOutput: {hookEventName: 'SessionStart', additionalContext: text},
  }),
};

function detectHost() {
  const flag = process.argv.find((arg) => arg.startsWith('--host='));
  if (flag) return flag.slice('--host='.length);
  return process.env.PLUGIN_DATA ? 'codex' : 'claude';
}

const HOST = detectHost();

// Writes `event` in HOST's envelope; a null shape means stay silent.
function emit(event, text) {
  const out = ENVELOPES[HOST][event](text);
  if (out != null) process.stdout.write(out);
}

module.exports = {HOST, emit};
