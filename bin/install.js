#!/usr/bin/env node
// Lemma installer — provider matrix + auto-detect + per-agent mechanism.
// One command configures every installed agent instead of hand-maintaining
// a separate JSON file per host.
//
// Everything is written to user-level (global) configs — available in every
// workspace, no per-project setup required. Nothing is written inside a
// project directory.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

// ---- helpers ----------------------------------------------------------------

const HOME = os.homedir();
const REPO_ROOT = path.resolve(__dirname, '..');
const ARGS = parseArgs(process.argv.slice(2));
const DRY_RUN = ARGS.flags.has('dry-run');
const UNINSTALL = ARGS.flags.has('uninstall');
const ONLY = ARGS.options.get('only');
const CONFIGURE = ARGS.options.get('configure');
const CONFIGURE_SURFACES = ['vscode', 'pycharm', 'jupyter'];

// ---- plugin-route source (remote-first: git push is the release action) ----
//
// Hosts with a native plugin/marketplace system (Claude Code, Codex, Copilot,
// Antigravity/agy, Gemini extensions) get pointed at the real published repo,
// not a locally-copied bundle — their own plugin manager owns fetching and
// (where supported) auto-updating it, the same way ~/src/ponytail does this.
// LEMMA_DEV_LOCAL=1 swaps in this checkout instead, so working on lemma
// itself doesn't require a push+round-trip to test a change.

const LEMMA_GITHUB_REPO = 'tkpratardan/lemma';
const LEMMA_GITHUB_URL = `https://github.com/${LEMMA_GITHUB_REPO}`;
const DEV_LOCAL = Boolean(process.env.LEMMA_DEV_LOCAL);

// owner/repo or URL, for CLIs whose marketplace/install commands take a bare
// string source (Codex, Copilot, agy, Gemini) — local path in dev mode.
function pluginSource() {
  return DEV_LOCAL ? REPO_ROOT : LEMMA_GITHUB_URL;
}

const HELP = ARGS.flags.has('help') || process.argv.includes('-h');

function parseArgs(argv) {
  const flags = new Set();
  const options = new Map();
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        options.set(key, argv[i + 1]);
        i += 2;
      } else {
        flags.add(key);
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  return { flags, options };
}

function which(name) {
  try {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch { return null; }
}

function appExists(appName) {
  return fs.existsSync(path.join('/Applications', `${appName}.app`)) ||
         fs.existsSync(path.join(HOME, 'Applications', `${appName}.app`));
}

function vscodeExtInstalled(extId) {
  try {
    const r = spawnSync('code', ['--list-extensions'], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0 && r.stdout.toLowerCase().includes(extId.toLowerCase());
  } catch { return false; }
}

function codexCli() {
  const onPath = which('codex');
  if (onPath) return onPath;
  if (process.platform === 'darwin') {
    const bundled = path.join('/Applications', 'Codex.app', 'Contents', 'Resources', 'codex');
    if (fs.existsSync(bundled)) return bundled;
    const userBundled = path.join(HOME, 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex');
    if (fs.existsSync(userBundled)) return userBundled;
  }
  return null;
}

function writeJsonMerge(filePath, merge) {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { }
  const updated = deepMerge(existing, merge);
  log(`  write ${filePath}`);
  if (!DRY_RUN) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n');
  }
}

function removeFromJson(filePath, keyPath) {
  let obj = {};
  try { obj = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return; }
  const keys = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null) return;
    cur = cur[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (cur[last] == null) return;
  delete cur[last];
  log(`  remove ${keyPath} from ${filePath}`);
  if (!DRY_RUN) {
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
  }
}

// Adds each of `items` to the array at `keyPath` if not already present.
// Idempotent: re-running install doesn't duplicate entries. Mirrors
// removeFromArrayInJson's "only touch matching entries" care, in reverse.
function addToArrayInJson(filePath, keyPath, items) {
  let obj = {};
  try { obj = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { }
  const keys = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = cur[keys[i]] || {};
    cur = cur[keys[i]];
  }
  const last = keys[keys.length - 1];
  const existing = Array.isArray(cur[last]) ? cur[last] : [];
  const missing = items.filter((item) => !existing.includes(item));
  if (missing.length === 0) return;
  cur[last] = existing.concat(missing);
  log(`  add ${missing.length} entr(y/ies) to ${keyPath} in ${filePath}`);
  if (!DRY_RUN) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
  }
}

// removeFromJson only deletes a whole key — wrong for an array a user may have
// added their own entries to (opencode's shared `instructions`/`plugin`
// arrays, Claude's `hooks.PreToolUse` list of matcher groups). This filters
// out only the items matching `predicate`, leaving the rest of the array (and
// the user's other entries in it) untouched. No-op, no write, if nothing
// matched — so re-running uninstall on an already-clean file is silent.
function removeFromArrayInJson(filePath, keyPath, predicate) {
  let obj = {};
  try { obj = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return; }
  const keys = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null) return;
    cur = cur[keys[i]];
  }
  const last = keys[keys.length - 1];
  if (!Array.isArray(cur[last])) return;
  const before = cur[last].length;
  const filtered = cur[last].filter((item) => !predicate(item));
  if (filtered.length === before) return; // nothing matched — no-op
  if (filtered.length === 0) {
    delete cur[last];
  } else {
    cur[last] = filtered;
  }
  log(`  remove ${before - filtered.length} matching item(s) from ${keyPath} in ${filePath}`);
  if (!DRY_RUN) {
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
  }
}

function deepMerge(target, source) {
  const result = Object.assign({}, target);
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && result[k] && typeof result[k] === 'object') {
      result[k] = deepMerge(result[k], v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

function log(msg) { console.log(msg); }
function ok(name) { console.log(`✓ ${name}`); }
function skip(name, reason) { console.log(`– ${name}: ${reason}`); }

// ---- resolve lemma-mcp command ---------------------------------------------

function lemmaMcpCommand() {
  // Prefer a globally-installed lemma-mcp binary on PATH.
  const onPath = which('lemma-mcp');
  if (onPath) return ['lemma-mcp'];
  // Fall back to running the compiled server.js from this repo (dev install).
  const serverJs = path.resolve(__dirname, '..', 'src', 'dist', 'mcp', 'server.js');
  if (fs.existsSync(serverJs)) return ['node', serverJs];
  return ['lemma-mcp']; // user must have it on PATH
}

// ---- Codex plugin install ---------------------------------------------------
//
// Codex uses plugins as the distribution unit for skills/hooks/MCP. Points at
// the real published repo (or this checkout under LEMMA_DEV_LOCAL) instead of
// a locally-copied bundle, matching how ~/src/ponytail installs itself there
// (`codex plugin marketplace add owner/repo`) — Codex's own plugin manager
// owns fetching it from here on, not lemma's installer.
//
const CODEX_MARKETPLACE_NAME = 'lemma';

function codexPluginSelector() {
  return `lemma@${CODEX_MARKETPLACE_NAME}`;
}

function installCodexPlugin() {
  const cli = codexCli();
  if (!cli) {
    log('  warning: codex CLI not found; skipping');
    return;
  }
  log(`  codex plugin marketplace add ${pluginSource()}`);
  if (!DRY_RUN) {
    const added = spawnSync(cli, ['plugin', 'marketplace', 'add', pluginSource()], { encoding: 'utf8', timeout: 60000 });
    if (added.status !== 0 || added.error) {
      const reason = (added.stderr || added.stdout || added.error?.message || 'unknown').trim();
      log(`  warning: codex plugin marketplace add failed: ${reason}`);
    }
  }
  log(`  codex plugin add ${codexPluginSelector()}`);
  if (!DRY_RUN) {
    const installed = spawnSync(cli, ['plugin', 'add', codexPluginSelector()], { encoding: 'utf8', timeout: 60000 });
    if (installed.status !== 0 || installed.error) {
      const reason = (installed.stderr || installed.stdout || installed.error?.message || 'unknown').trim();
      log(`  warning: codex plugin add failed: ${reason}`);
    }
  }
}

function uninstallCodexPlugin() {
  const cli = codexCli();
  if (!cli) {
    log('  warning: codex CLI not found; nothing to uninstall');
    return;
  }
  log(`  codex plugin remove ${codexPluginSelector()}`);
  if (!DRY_RUN) {
    spawnSync(cli, ['plugin', 'remove', codexPluginSelector()], { encoding: 'utf8', timeout: 60000 });
  }
  log(`  codex plugin marketplace remove ${CODEX_MARKETPLACE_NAME}`);
  if (!DRY_RUN) {
    spawnSync(cli, ['plugin', 'marketplace', 'remove', CODEX_MARKETPLACE_NAME], { encoding: 'utf8', timeout: 60000 });
  }
}

// ---- Copilot CLI plugin install ---------------------------------------------
//
// Points at the real published repo (or this checkout under LEMMA_DEV_LOCAL)
// instead of a locally-copied bundle — confirmed against the real `copilot`
// CLI this session (`copilot plugin --help` / `copilot plugin marketplace
// add --help`): `marketplace add <source>` takes "owner/repo for GitHub, URL,
// or local path" directly, and the uninstall verb is `uninstall`, not
// `remove` (the prior local-bundle code had this wrong).
//
// Hooks: confirmed live for Copilot CLI and for Codex (the latter gated
// behind a one-time user trust step) per each host's own plugin docs.

const COPILOT_MARKETPLACE_NAME = 'lemma';
const COPILOT_PLUGIN_SELECTOR = 'lemma@lemma'; // name@marketplace, both "lemma" per .github/plugin/marketplace.json

function installCopilotPlugin() {
  const cli = which('copilot');
  if (!cli) {
    log('  warning: copilot CLI not found; skipping');
    return;
  }
  log(`  copilot plugin marketplace add ${pluginSource()}`);
  if (!DRY_RUN) {
    const added = spawnSync(cli, ['plugin', 'marketplace', 'add', pluginSource()], { encoding: 'utf8', timeout: 60000 });
    if (added.status !== 0 || added.error) {
      const reason = (added.stderr || added.stdout || added.error?.message || 'unknown').trim();
      log(`  warning: copilot plugin marketplace add failed: ${reason}`);
    }
  }
  log(`  copilot plugin install ${COPILOT_PLUGIN_SELECTOR}`);
  if (!DRY_RUN) {
    const installed = spawnSync(cli, ['plugin', 'install', COPILOT_PLUGIN_SELECTOR],
      { encoding: 'utf8', timeout: 60000 });
    if (installed.status !== 0 || installed.error) {
      const reason = (installed.stderr || installed.stdout || installed.error?.message || 'unknown').trim();
      log(`  warning: copilot plugin install failed: ${reason}`);
    }
  }
}

function uninstallCopilotPlugin() {
  const cli = which('copilot');
  if (!cli) {
    log('  warning: copilot CLI not found; nothing to uninstall');
    return;
  }
  log(`  copilot plugin uninstall ${COPILOT_PLUGIN_SELECTOR}`);
  if (!DRY_RUN) {
    const r = spawnSync(cli, ['plugin', 'uninstall', COPILOT_PLUGIN_SELECTOR], { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0 || r.error) {
      const reason = (r.stderr || r.stdout || r.error?.message || 'unknown').trim();
      log(`  warning: copilot plugin uninstall failed: ${reason}`);
    }
  }
  log(`  copilot plugin marketplace remove ${COPILOT_MARKETPLACE_NAME}`);
  if (!DRY_RUN) {
    spawnSync(cli, ['plugin', 'marketplace', 'remove', COPILOT_MARKETPLACE_NAME], { encoding: 'utf8', timeout: 60000 });
  }
}

// ---- OpenClaw plugin install -------------------------------------------------
//
// Confirmed against the real `openclaw` CLI this session: `openclaw plugins
// install lemma --marketplace <source>` reads the same `.claude-plugin/`
// marketplace manifest Claude Code uses (`openclaw plugins list` showed it
// installed as format "bundle", version correctly read from package.json,
// and `openclaw plugins doctor` reported no issues) — no ClawHub publish
// needed, which the previous local-skills-copy-only approach had assumed.
// `--force` skips the interactive confirm prompt on uninstall (confirmed:
// without it, uninstall fails outside a TTY asking for y/N).

function installOpenclawPlugin() {
  const cli = which('openclaw');
  if (!cli) {
    log('  warning: openclaw CLI not found; skipping');
    return;
  }
  log(`  openclaw plugins install lemma --marketplace ${pluginSource()}`);
  if (!DRY_RUN) {
    const r = spawnSync(cli, ['plugins', 'install', 'lemma', '--marketplace', pluginSource(), '--force'],
      { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0 || r.error) {
      const reason = (r.stderr || r.stdout || r.error?.message || 'unknown').trim();
      log(`  warning: openclaw plugins install failed: ${reason}`);
    }
  }
}

function uninstallOpenclawPlugin() {
  const cli = which('openclaw');
  if (!cli) {
    log('  warning: openclaw CLI not found; nothing to uninstall');
    return;
  }
  log('  openclaw plugins uninstall lemma --force');
  if (!DRY_RUN) {
    spawnSync(cli, ['plugins', 'uninstall', 'lemma', '--force'], { encoding: 'utf8', timeout: 60000 });
  }
}

// ---- OpenClaw bootstrap file install ------------------------------------------
//
// AGENTS.md is one of OpenClaw's own documented workspace bootstrap files,
// loaded into the system prompt at session start — a plain file, no hook or
// CLI step needed. Marker-fenced so uninstall only ever touches lemma's own
// block, never a user's existing AGENTS.md content.

const OPENCLAW_MARK_BEGIN = '<!-- lemma-begin -->';
const OPENCLAW_MARK_END = '<!-- lemma-end -->';

function openclawWorkspaceDir() {
  return process.env.OPENCLAW_WORKSPACE || path.join(HOME, '.openclaw', 'workspace');
}

function readOpenclawAgentsMd(agentsMdPath) {
  try { return fs.readFileSync(agentsMdPath, 'utf8'); } catch { return ''; }
}

function installOpenclawBootstrap() {
  const agentsMdPath = path.join(openclawWorkspaceDir(), 'AGENTS.md');
  log(`  update ${agentsMdPath} (lemma persona block)`);
  if (DRY_RUN) return;

  const existing = readOpenclawAgentsMd(agentsMdPath);
  if (existing.includes(OPENCLAW_MARK_BEGIN)) return;

  const persona = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8').trim();
  const block = `${OPENCLAW_MARK_BEGIN}\n${persona}\n${OPENCLAW_MARK_END}\n`;
  const prefix = existing ? existing.replace(/\n*$/, '\n\n') : '';
  fs.mkdirSync(path.dirname(agentsMdPath), { recursive: true });
  fs.writeFileSync(agentsMdPath, prefix + block);
}

function uninstallOpenclawBootstrap() {
  const agentsMdPath = path.join(openclawWorkspaceDir(), 'AGENTS.md');
  const existing = readOpenclawAgentsMd(agentsMdPath);
  if (!existing) return;

  const begin = existing.indexOf(OPENCLAW_MARK_BEGIN);
  const end = existing.indexOf(OPENCLAW_MARK_END);
  if (begin === -1 || end === -1 || end <= begin) return;

  const before = existing.slice(0, begin);
  const after = existing.slice(end + OPENCLAW_MARK_END.length);
  const next = (before.replace(/\n*$/, '\n') + after.replace(/^\n*/, '')).trim();
  log(`  remove lemma persona block from ${agentsMdPath}`);
  if (DRY_RUN) return;
  if (next === '') {
    fs.rmSync(agentsMdPath, { force: true });
  } else {
    fs.writeFileSync(agentsMdPath, next + '\n');
  }
}

// ---- Cursor hooks install ----------------------------------------------------
//
// ~/.cursor/hooks.json is a plain global config file, confirmed at
// cursor.com/docs/hooks — no plugin marketplace involved, so this merges in
// directly, same as ~/.cursor/mcp.json above.

// Each Cursor hook event lemma wires up, and the script it runs.
const CURSOR_HOOKS = [
  { event: 'sessionStart', script: 'cursor-session-start.js' },
  { event: 'beforeSubmitPrompt', script: 'cursor-clear-discard.js' },
  { event: 'afterMCPExecution', script: 'cursor-detect-discard.js' },
  { event: 'beforeMCPExecution', script: 'cursor-deny-if-discarded.js' },
  { event: 'beforeShellExecution', script: 'cursor-deny-if-discarded.js' },
  { event: 'beforeReadFile', script: 'cursor-deny-if-discarded.js' },
];

function cursorHooksPath() {
  return path.join(HOME, '.cursor', 'hooks.json');
}

// Matches by script filename, not object equality, so re-install replaces
// lemma's entry instead of appending a duplicate each time.
function isCursorLemmaHook(script) {
  return (entry) => Boolean(entry) && typeof entry.command === 'string' &&
    entry.command.includes(script);
}

function installCursorHook() {
  const filePath = cursorHooksPath();
  log(`  install hooks → ${filePath}`);
  if (DRY_RUN) return;

  let config = {};
  try { config = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { }
  config.version = config.version || 1;
  config.hooks = config.hooks || {};
  for (const { event, script } of CURSOR_HOOKS) {
    const existing = Array.isArray(config.hooks[event]) ? config.hooks[event] : [];
    const entry = { command: `node "${path.join(REPO_ROOT, 'hooks', script)}"`, timeout: 5 };
    config.hooks[event] = existing.filter((h) => !isCursorLemmaHook(script)(h));
    config.hooks[event].push(entry);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
}

function uninstallCursorHook() {
  for (const { event, script } of CURSOR_HOOKS) {
    removeFromArrayInJson(cursorHooksPath(), `hooks.${event}`, isCursorLemmaHook(script));
  }
}

// ---- provider matrix --------------------------------------------------------
// Everything writes to user-level (~/) paths — global, no per-project config.

function vscodeMcpJson() {
  // VS Code 1.99+ also recognises a standalone global mcp.json alongside
  // settings.json (confirmed at VS Code 1.126.0 — this is the file VS Code's
  // own MCP panel opens and shows, so it's now the PRIMARY path to write).
  // macOS: ~/Library/Application Support/Code/User/mcp.json
  // Linux: ~/.config/Code/User/mcp.json
  return process.platform === 'darwin'
    ? path.join(HOME, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
    : path.join(HOME, '.config', 'Code', 'User', 'mcp.json');
}

// Works around agy misparsing an @-scoped path (e.g. npm's node_modules/@scope/pkg) as plugin@marketplace.
function agyInstallPath(target) {
  if (!target.split(path.sep).some((seg) => seg.startsWith('@'))) {
    return { path: target, cleanup: () => {} };
  }
  const link = path.join(os.tmpdir(), `lemma-agy-install-${Date.now()}`);
  fs.symlinkSync(target, link);
  return { path: link, cleanup: () => fs.rmSync(link, { force: true }) };
}

function makeProviders(cmd) {
  const mcpEntry = { command: cmd[0], ...(cmd.length > 1 ? { args: cmd.slice(1) } : {}) };

  return [
    {
      id: 'cursor',
      label: 'Cursor',
      detect: () => appExists('Cursor') || Boolean(which('cursor')),
      // Confirmed at cursor.com/docs/context/skills: ~/.cursor/skills/ is a
      // real global discovery path, same tier as ~/.claude/skills below —
      // no plugin marketplace needed for skills specifically.
      skillsDir: path.join(HOME, '.cursor', 'skills'),
      install() {
        writeJsonMerge(path.join(HOME, '.cursor', 'mcp.json'), {
          mcpServers: { lemma: mcpEntry },
        });
        installCursorHook();
        installCursorPermissions();
      },
      uninstall() {
        removeFromJson(path.join(HOME, '.cursor', 'mcp.json'), 'mcpServers.lemma');
        uninstallCursorHook();
        uninstallCursorPermissions();
      },
    },
    {
      id: 'vscode',
      label: 'VS Code',
      detect: () => Boolean(which('code')),
      install() {
        const entry = { type: 'stdio', command: cmd[0], ...(cmd.length > 1 ? { args: cmd.slice(1) } : {}) };
        // Standalone global mcp.json ({"servers":…}) is what VS Code's own MCP
        // panel opens and reads. Writing MCP config into settings.json is
        // deprecated (VS Code now warns and offers to migrate it away), so
        // this is the only path written.
        writeJsonMerge(vscodeMcpJson(), { servers: { lemma: entry } });
      },
      uninstall() {
        removeFromJson(vscodeMcpJson(), 'servers.lemma');
      },
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      detect: () => Boolean(which('claude')),
      // No skillsDir: skills/persona/hooks/MCP now all arrive through the
      // plugin bundle (.claude-plugin/) instead of a direct copy — a raw
      // ~/.claude/skills copy alongside it would double up the same skills.
      install() {
        // Old direct-write config from before the plugin-route switch —
        // clean it up so it can't linger alongside the new plugin install.
        removeFromJson(path.join(HOME, '.claude.json'), 'mcpServers.lemma');
        removeSkillsFrom(path.join(HOME, '.claude', 'skills'));

        const cli = which('claude');
        if (!cli) {
          log('  warning: claude CLI not found; skipping');
          return;
        }
        // Writing straight to ~/.claude/settings.json's extraKnownMarketplaces
        // is NOT equivalent to `marketplace add` — confirmed the hard way:
        // `claude plugin marketplace update`/`plugin install` both read the
        // separate runtime registry (~/.claude/plugins/known_marketplaces.json)
        // and reported the marketplace as unknown even with the settings.json
        // entry present. The real subprocess call is what actually populates
        // that registry (and, as a side effect, extraKnownMarketplaces too).
        log(`  claude plugin marketplace add ${pluginSource()}`);
        let marketplaceAdded = DRY_RUN;
        if (!DRY_RUN) {
          const added = spawnSync(cli, ['plugin', 'marketplace', 'add', pluginSource()], { encoding: 'utf8', timeout: 60000 });
          if (added.status !== 0 || added.error) {
            const reason = (added.stderr || added.stdout || added.error?.message || 'unknown').trim();
            log(`  warning: claude plugin marketplace add failed: ${reason}`);
          } else {
            marketplaceAdded = true;
          }
        }
        // `marketplace add` doesn't expose an --auto-update flag, so layer the
        // opt-in on top of whatever it just wrote (confirmed real field/path
        // this session: extraKnownMarketplaces.lemma.autoUpdate in settings.json;
        // off by default for a non-official marketplace). Only when the add
        // above actually succeeded — otherwise this writes an entry with no
        // `source` field, which fails settings.json's own schema entirely.
        if (marketplaceAdded) {
          writeJsonMerge(path.join(HOME, '.claude', 'settings.json'), {
            extraKnownMarketplaces: { lemma: { autoUpdate: true } },
          });
        }
        log(`  claude plugin install lemma@lemma`);
        if (!DRY_RUN) {
          const installed = spawnSync(cli, ['plugin', 'install', 'lemma@lemma'], { encoding: 'utf8', timeout: 60000 });
          if (installed.status !== 0 || installed.error) {
            const reason = (installed.stderr || installed.stdout || installed.error?.message || 'unknown').trim();
            log(`  warning: claude plugin install failed: ${reason}`);
          }
        }
      },
      uninstall() {
        const cli = which('claude');
        if (cli) {
          log('  claude plugin uninstall lemma@lemma');
          if (!DRY_RUN) {
            spawnSync(cli, ['plugin', 'uninstall', 'lemma@lemma'], { encoding: 'utf8', timeout: 60000 });
          }
        }
        removeFromJson(path.join(HOME, '.claude', 'settings.json'), 'extraKnownMarketplaces.lemma');
        removeFromJson(path.join(HOME, '.claude.json'), 'mcpServers.lemma');
        // `claude plugin marketplace remove` (above) can leave a vestigial
        // empty `"extraKnownMarketplaces": {}` behind (confirmed this
        // session) — same cleanup as uninstallHooks/uninstallPermissions.
        const globalSettings = path.join(HOME, '.claude', 'settings.json');
        try {
          const settings = JSON.parse(fs.readFileSync(globalSettings, 'utf8'));
          if (settings.extraKnownMarketplaces && Object.keys(settings.extraKnownMarketplaces).length === 0) {
            delete settings.extraKnownMarketplaces;
            if (!DRY_RUN) fs.writeFileSync(globalSettings, JSON.stringify(settings, null, 2) + '\n');
          }
        } catch { /* file missing or unparsable — nothing to clean */ }
      },
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      detect: () => appExists('Claude'),
      install() {
        const configDir = process.platform === 'darwin'
          ? path.join(HOME, 'Library', 'Application Support', 'Claude')
          : path.join(HOME, '.config', 'Claude');
        const file = path.join(configDir, 'claude_desktop_config.json');
        writeJsonMerge(file, { mcpServers: { lemma: mcpEntry } });
        addToArrayInJson(file, 'mcpServers.lemma.alwaysAllow', VSCODE_TOOL_NAMES);
      },
      uninstall() {
        const configDir = process.platform === 'darwin'
          ? path.join(HOME, 'Library', 'Application Support', 'Claude')
          : path.join(HOME, '.config', 'Claude');
        removeFromJson(path.join(configDir, 'claude_desktop_config.json'), 'mcpServers.lemma');
      },
    },
    {
      id: 'codex',
      label: 'Codex CLI / IDE extension / app',
      detect: () => Boolean(codexCli()) || appExists('Codex') || vscodeExtInstalled('openai.chatgpt'),
      install() {
        installCodexPlugin();
        installCodexTomlPermissions();
      },
      uninstall() {
        uninstallCodexPlugin();
        uninstallCodexTomlPermissions();
      },
    },
    {
      id: 'copilot',
      label: 'GitHub Copilot CLI',
      detect: () => Boolean(which('copilot')),
      install() {
        installCopilotPlugin();
      },
      uninstall() {
        uninstallCopilotPlugin();
      },
    },
    {
      id: 'openclaw',
      label: 'OpenClaw',
      detect: () => Boolean(which('openclaw')) || Boolean(which('clawhub')),
      install() {
        installOpenclawPlugin();
        installOpenclawBootstrap();
      },
      uninstall() {
        uninstallOpenclawPlugin();
        uninstallOpenclawBootstrap();
      },
    },
    {
      id: 'antigravity-gemini',
      label: 'Antigravity / Gemini CLI',
      detect: () => Boolean(which('agy')) || Boolean(which('gemini')),
      install() {
        // agy has no `extensions` subcommand (renamed to `plugin`, confirmed
        // against the real CLI); `plugin install <source>` is its equivalent.
        // No `--auto-update` flag exists for agy (confirmed: no `plugin
        // update` subcommand at all) — refreshing means uninstall+reinstall.
        if (which('agy')) {
          log(`  agy plugin install ${pluginSource()}`);
          if (!DRY_RUN) {
            const { path: installPath, cleanup } = agyInstallPath(pluginSource());
            const r = spawnSync('agy', ['plugin', 'install', installPath], { encoding: 'utf8', timeout: 30000 });
            cleanup();
            if (r.status !== 0 || r.error) {
              log(`  warning: agy plugin install failed: ${(r.stderr || r.stdout || r.error?.message || 'unknown').trim()}`);
            }
          }
          installAntigravityPermissions();
          return;
        }
        // `link` is for a local dev checkout (live-reflects edits, no
        // reinstall needed); `install --auto-update` is the remote-fetch
        // path with real background auto-update (confirmed via `gemini
        // extensions install --help`: "--auto-update  Enable auto-update for
        // this extension."). `--consent` skips the interactive confirm
        // prompt either way, which would otherwise block forever reading
        // stdin spawnSync never supplies.
        if (DEV_LOCAL) {
          log(`  gemini extensions link ${REPO_ROOT} --consent`);
          if (!DRY_RUN) {
            const r = spawnSync('gemini', ['extensions', 'link', REPO_ROOT, '--consent'],
              { encoding: 'utf8', timeout: 15000 });
            if (r.status !== 0 || r.error) {
              const reason = r.error?.code === 'ETIMEDOUT'
                ? 'timed out after 15s'
                : (r.stderr || r.stdout || r.error?.message || 'unknown').trim();
              log(`  warning: gemini extensions link failed: ${reason}`);
            }
          }
          return;
        }
        log(`  gemini extensions install ${LEMMA_GITHUB_URL} --auto-update --consent`);
        if (!DRY_RUN) {
          const r = spawnSync('gemini', ['extensions', 'install', LEMMA_GITHUB_URL, '--auto-update', '--consent'],
            { encoding: 'utf8', timeout: 15000 });
          if (r.status !== 0 || r.error) {
            const reason = r.error?.code === 'ETIMEDOUT'
              ? 'timed out after 15s'
              : (r.stderr || r.stdout || r.error?.message || 'unknown').trim();
            log(`  warning: gemini extensions install failed: ${reason}`);
          }
        }
      },
      uninstall() {
        if (which('agy')) {
          log('  agy plugin uninstall lemma');
          if (!DRY_RUN) {
            spawnSync('agy', ['plugin', 'uninstall', 'lemma'], { encoding: 'utf8', timeout: 15000 });
          }
          uninstallAntigravityPermissions();
          return;
        }
        log('  gemini extensions uninstall lemma');
        if (!DRY_RUN) {
          spawnSync('gemini', ['extensions', 'uninstall', 'lemma'], { encoding: 'utf8', timeout: 15000 });
        }
      },
    },
    {
      id: 'opencode',
      label: 'opencode',
      detect: () => Boolean(which('opencode')),
      // opencode scans ~/.config/opencode/skills/ (its own canonical global
      // dir) plus ~/.claude/skills/ for Claude-compatibility; target its own.
      skillsDir: path.join(HOME, '.config', 'opencode', 'skills'),
      install() {
        // ~/.config/opencode/opencode.json is the actual global config path
        // (~/.opencode/config.json, tried earlier, only holds plugins/skills
        // subdirs — see https://opencode.ai/docs/config/). The plugin
        // (.opencode/plugins/lemma.mjs) is the single persona channel: it
        // injects AGENTS.md into every request's system prompt and handles
        // the `/lemma [on|off]` mode switch. An `instructions` entry would
        // put a second copy of the persona in the same request, so none is
        // written (and one from an older install is removed), and the MCP
        // instructions copy is suppressed via env for the same reason.
        const configFile = path.join(HOME, '.config', 'opencode', 'opencode.json');
        writeJsonMerge(configFile, {
          $schema: 'https://opencode.ai/config.json',
          plugin: [path.join(REPO_ROOT, '.opencode', 'plugins', 'lemma.mjs')],
          mcp: {
            lemma: {
              type: 'local',
              command: cmd,
              enabled: true,
              environment: { LEMMA_NO_MCP_INSTRUCTIONS: '1' },
            },
          },
        });
        removeFromArrayInJson(configFile, 'instructions', (v) => v === path.join(REPO_ROOT, 'AGENTS.md'));
        installOpencodePermissions();
      },
      uninstall() {
        const configFile = path.join(HOME, '.config', 'opencode', 'opencode.json');
        removeFromJson(configFile, 'mcp.lemma');
        // `instructions`/`plugin` are shared top-level arrays the user may
        // have added their own entries to, so filter out only lemma's exact
        // paths (the same values install() wrote) — leaves any other entry
        // untouched, instead of the old "leave it all in" workaround.
        const agentsPath = path.join(REPO_ROOT, 'AGENTS.md');
        const pluginPath = path.join(REPO_ROOT, '.opencode', 'plugins', 'lemma.mjs');
        removeFromArrayInJson(configFile, 'instructions', (v) => v === agentsPath);
        removeFromArrayInJson(configFile, 'plugin', (v) => v === pluginPath);
        uninstallOpencodePermissions();
      },
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      detect: () => appExists('Windsurf') || Boolean(which('windsurf')),
      install() {
        const file = path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json');
        writeJsonMerge(file, { mcpServers: { lemma: mcpEntry } });
        addToArrayInJson(file, 'mcpServers.lemma.alwaysAllow', VSCODE_TOOL_NAMES);
      },
      uninstall() {
        removeFromJson(path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers.lemma');
      },
    },
  ];
}

// ---- hooks (always global — persona applies everywhere) ---------------------

function installHooks() {
  const hooksSource = path.join(__dirname, '..', 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksSource)) return;
  // ${CLAUDE_PLUGIN_ROOT} is only set when running as a plugin (claude plugin
  // install). In global ~/.claude/settings.json, it's undefined — substitute
  // the actual absolute path to this repo's hooks directory.
  const rawConfig = fs.readFileSync(hooksSource, 'utf8')
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, REPO_ROOT);
  const hooksConfig = JSON.parse(rawConfig);
  const globalSettings = path.join(HOME, '.claude', 'settings.json');
  log(`  install hooks → ${globalSettings} (global)`);
  if (!DRY_RUN) {
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(globalSettings, 'utf8')); } catch { }
    settings.hooks = deepMerge(settings.hooks || {}, hooksConfig.hooks);
    fs.mkdirSync(path.dirname(globalSettings), { recursive: true });
    fs.writeFileSync(globalSettings, JSON.stringify(settings, null, 2) + '\n');
  }
}

function uninstallHooks() {
  const globalSettings = path.join(HOME, '.claude', 'settings.json');
  removeFromJson(globalSettings, 'hooks.SessionStart');
  removeFromJson(globalSettings, 'hooks.UserPromptSubmit');
  // Shared arrays other tools' hooks can live in too, so filter out only
  // lemma's own groups (by command filename, not absolute path) rather than
  // deleting the whole key.
  const isLemmaHookGroup = (name) => (group) =>
    group && (
      group.matcher === 'mcp__lemma__execute_cell' ||
      (Array.isArray(group.hooks) && group.hooks.some((h) => h.command && h.command.includes(name)))
    );
  removeFromArrayInJson(globalSettings, 'hooks.PreToolUse', isLemmaHookGroup('pre-tool-use.js'));
  removeFromArrayInJson(globalSettings, 'hooks.PostToolUse', isLemmaHookGroup('post-tool-use.js'));
  // The three removals above can leave a vestigial empty `"hooks": {}` (none
  // of them clean up their now-empty parent). Harmless to Claude Code either
  // way, but drop it so a fully-uninstalled settings.json has no leftover key.
  try {
    const settings = JSON.parse(fs.readFileSync(globalSettings, 'utf8'));
    if (settings.hooks && Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
      if (!DRY_RUN) fs.writeFileSync(globalSettings, JSON.stringify(settings, null, 2) + '\n');
    }
  } catch { /* file missing or unparsable — nothing to clean */ }
}

// ---- skills (per-host: each agent that scans a skills dir gets a copy) -------
//
// Unlike MCP/persona/hooks (a pointer at the file the package already sits
// at), skills are discovered by directory scan, so they must be physically
// copied to a location the host scans. Each provider that supports SKILL.md
// declares a global `skillsDir`; the main loop copies lemma's skills there.
//
// Verified global skill dirs: claude-code → ~/.claude/skills (also scanned by
// opencode etc.), opencode → ~/.config/opencode/skills. Windsurf/Cursor only
// document *project* skill dirs (.windsurf/skills/, .cursor/skills/) — no
// verified global path, so left unwired rather than guessed.

function lemmaSkillNames() {
  const skillsDir = path.join(REPO_ROOT, 'skills');
  try {
    return fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(skillsDir, e.name, 'SKILL.md')))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function copySkillsTo(destRoot) {
  const names = lemmaSkillNames();
  if (names.length === 0) return;
  log(`  install ${names.length} skill(s) → ${destRoot}`);
  if (!DRY_RUN) {
    for (const name of names) {
      const dest = path.join(destRoot, name);
      // Refresh on re-run so edits propagate; recursive copy in case a skill
      // ever ships more than its SKILL.md (scripts, references).
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(path.join(REPO_ROOT, 'skills', name), dest, { recursive: true });
    }
  }
}

function removeSkillsFrom(destRoot) {
  // Remove only lemma's own skill dirs (all `lemma-` prefixed), never the
  // user's other skills living in the same directory.
  for (const name of lemmaSkillNames()) {
    const dest = path.join(destRoot, name);
    log(`  remove ${dest}`);
    if (!DRY_RUN) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }
}

// ---- permissions (claude-code only: vscode_* tools are pre-approved) --------
//
// The vscode_* tools are already gated by the in-editor diff/accept-discard
// flow (lemma.confirmEdits) — a second manual permission prompt on top of that
// is redundant friction. Only vscode_* is pre-approved: pycharm_* and
// jupyterlab_* have no equivalent in-editor gate, so they keep the normal
// permission prompt.

const VSCODE_TOOL_NAMES = [
  'vscode_status', 'vscode_read_notebook', 'vscode_get_state', 'vscode_execute_cell',
  'vscode_probe', 'vscode_add_and_run', 'vscode_run_cell', 'vscode_read_cell_output',
  'vscode_run_all_cells', 'vscode_edit_cell', 'vscode_edit_and_run', 'vscode_insert_cell',
  'vscode_delete_cell', 'vscode_add_markdown', 'vscode_restart_kernel', 'vscode_inspect_variable',
  'vscode_clear_notebook', 'vscode_save_notebook',
];

function installPermissions() {
  const globalSettings = path.join(HOME, '.claude', 'settings.json');
  log(`  allow-list vscode_* tools → ${globalSettings} (global)`);
  addToArrayInJson(globalSettings, 'permissions.allow',
    VSCODE_TOOL_NAMES.map((name) => `mcp__lemma__${name}`));
}

function uninstallPermissions() {
  const globalSettings = path.join(HOME, '.claude', 'settings.json');
  const lemmaVscodeTools = new Set(VSCODE_TOOL_NAMES.map((name) => `mcp__lemma__${name}`));
  removeFromArrayInJson(globalSettings, 'permissions.allow', (item) => lemmaVscodeTools.has(item));
  // Drop a vestigial empty `"permissions": {}` left behind when allow was the
  // only key present (mirrors uninstallHooks' equivalent cleanup).
  try {
    const settings = JSON.parse(fs.readFileSync(globalSettings, 'utf8'));
    if (settings.permissions && Object.keys(settings.permissions).length === 0) {
      delete settings.permissions;
      if (!DRY_RUN) fs.writeFileSync(globalSettings, JSON.stringify(settings, null, 2) + '\n');
    }
  } catch { /* file missing or unparsable — nothing to clean */ }
}

// cursor.com/docs/reference/permissions: mcpAllowlist entries are "<server>:<tool>".
function installCursorPermissions() {
  const file = path.join(HOME, '.cursor', 'permissions.json');
  addToArrayInJson(file, 'mcpAllowlist', VSCODE_TOOL_NAMES.map((name) => `lemma:${name}`));
}

function uninstallCursorPermissions() {
  const file = path.join(HOME, '.cursor', 'permissions.json');
  const lemmaVscodeTools = new Set(VSCODE_TOOL_NAMES.map((name) => `lemma:${name}`));
  removeFromArrayInJson(file, 'mcpAllowlist', (item) => lemmaVscodeTools.has(item));
}

function installAntigravityPermissions() {
  const file = path.join(HOME, '.gemini', 'antigravity-cli', 'settings.json');
  addToArrayInJson(file, 'permissions.allow', VSCODE_TOOL_NAMES.map((name) => `mcp(lemma/${name})`));
}

function uninstallAntigravityPermissions() {
  const file = path.join(HOME, '.gemini', 'antigravity-cli', 'settings.json');
  const lemmaVscodeTools = new Set(VSCODE_TOOL_NAMES.map((name) => `mcp(lemma/${name})`));
  removeFromArrayInJson(file, 'permissions.allow', (item) => lemmaVscodeTools.has(item));
}

// opencode.ai/docs/permissions: MCP tools are named `<server>_<tool>` and
// permission patterns support wildcards, so one rule covers all of vscode_*.
function installOpencodePermissions() {
  const file = path.join(HOME, '.config', 'opencode', 'opencode.json');
  writeJsonMerge(file, { permission: { 'lemma_vscode_*': 'allow' } });
}

function uninstallOpencodePermissions() {
  const file = path.join(HOME, '.config', 'opencode', 'opencode.json');
  removeFromJson(file, 'permission.lemma_vscode_*');
}

const CODEX_TOML_START = '# --- lemma vscode_* tool approvals (managed by lemma installer) ---';
const CODEX_TOML_END = '# --- end lemma vscode_* tool approvals ---';

function codexConfigTomlPath() {
  return path.join(HOME, '.codex', 'config.toml');
}

// `codex plugin remove` strips everything under plugins."..." on its own,
// including our start marker, so only the end marker may survive by the time
// this runs — handle either marker missing, not just both present.
function stripCodexTomlBlock(content) {
  const start = content.indexOf(CODEX_TOML_START);
  const end = content.indexOf(CODEX_TOML_END);
  if (start === -1 && end === -1) return content;
  const from = start === -1 ? end : start;
  const to = end === -1 ? start + CODEX_TOML_START.length : end + CODEX_TOML_END.length;
  return content.slice(0, from).replace(/\n+$/, '\n') + content.slice(to).replace(/^\n+/, '\n');
}

// developers.openai.com/codex/mcp: a plugin-bundled server's settings are
// overridden under plugins."<id>".mcp_servers.<name>, not top-level
// mcp_servers.<name> (that path needs its own command/url; this one doesn't).
function installCodexTomlPermissions() {
  const file = codexConfigTomlPath();
  let content = '';
  try { content = fs.readFileSync(file, 'utf8'); } catch { }
  content = stripCodexTomlBlock(content);
  const base = `plugins."${codexPluginSelector()}".mcp_servers.lemma`;
  const tables = [
    `[${base}]\ndefault_tools_approval_mode = "prompt"`,
    ...VSCODE_TOOL_NAMES.map((name) => `[${base}.tools.${name}]\napproval_mode = "approve"`),
  ];
  const withBlock = `${content.replace(/\n*$/, '\n')}\n${CODEX_TOML_START}\n${tables.join('\n\n')}\n${CODEX_TOML_END}\n`;
  log(`  write vscode_* tool approvals → ${file}`);
  if (!DRY_RUN) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, withBlock);
  }
}

function uninstallCodexTomlPermissions() {
  const file = codexConfigTomlPath();
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch { return; }
  const stripped = stripCodexTomlBlock(content);
  if (stripped === content) return;
  log(`  remove vscode_* tool approvals from ${file}`);
  if (!DRY_RUN) {
    fs.writeFileSync(file, stripped);
  }
}

// ---- editor extension (the vscode_* surface) --------------------------------
//
// The vscode_* tools need the Lemma VS Code extension installed in the editor.
// Automate it via the editor CLIs (`code` / `cursor --install-extension`) so it
// rides the one install instead of a manual sideload per editor.
//
// Install source: $LEMMA_VSIX (a local .vsix, for testing a build before it's
// published) if set, otherwise the marketplace id `tkpratardan.lemma-datascience`.
// `cursor --install-extension` still rejects this id as "not found" even once
// listed on Cursor's own marketplace mirror — confirmed, not a propagation
// delay, likely a separate moderation gate outside lemma's control; see
// docs/INSTALL.md. A missing listing fails only that editor's install (a
// logged warning, not fatal).

const EXTENSION_ID = 'tkpratardan.lemma-datascience';
const EDITOR_CLIS = ['code', 'cursor'];

function extensionSource() {
  if (process.env.LEMMA_VSIX && fs.existsSync(process.env.LEMMA_VSIX)) {
    return process.env.LEMMA_VSIX;
  }
  return EXTENSION_ID;
}

function installExtension() {
  const editors = EDITOR_CLIS.filter((c) => which(c));
  if (editors.length === 0) {
    skip('VS Code / Cursor extension', 'no code/cursor CLI on PATH');
    return;
  }
  const src = extensionSource();
  for (const cli of editors) {
    log(`  ${cli} --install-extension ${src}`);
    if (!DRY_RUN) {
      // --force overwrites without prompting; timeout so a stuck CLI can't hang
      // the whole install (the gemini-link lesson).
      const r = spawnSync(cli, ['--install-extension', src, '--force'],
        { encoding: 'utf8', timeout: 60000 });
      // Both CLIs exit 0 even when the extension isn't found on their
      // marketplace, so status alone isn't reliable — scan output text too.
      // Strip Node-runtime noise (e.g. a DeprecationWarning) first: it
      // previously false-positived as a failure and won "last line" below.
      const lines = `${r.stdout || ''}\n${r.stderr || ''}`.split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^\(node:\d+\)|DeprecationWarning|--trace-deprecation/.test(l));
      const text = lines.join('\n');
      const failed = r.status !== 0 || /not found\.?$|failed installing extensions/i.test(text);
      if (failed) {
        const reason = lines.pop() || r.error?.message || 'unknown';
        log(`  warning: ${cli} extension install failed: ${reason}`);
      }
    }
  }
}

function uninstallExtension() {
  for (const cli of EDITOR_CLIS.filter((c) => which(c))) {
    log(`  ${cli} --uninstall-extension ${EXTENSION_ID}`);
    if (!DRY_RUN) {
      spawnSync(cli, ['--uninstall-extension', EXTENSION_ID], { encoding: 'utf8', timeout: 60000 });
    }
  }
}

// ---- help -------------------------------------------------------------------

const HELP_OPTIONS = [
  ['--dry-run', ['Preview what would change for each detected agent; writes nothing.']],
  ['--uninstall', ['Remove Lemma from every detected agent, or just the one named by --only.']],
  ['--only <id>', [
    'Configure a single agent instead of every detected one. <id> is one of:',
    'cursor, vscode, claude-code, claude-desktop, codex, copilot, openclaw,',
    'antigravity-gemini, opencode, windsurf',
  ]],
  ['--configure <surface>', [
    "Register only one notebook surface's MCP tools instead of all three.",
    '<surface> is one of:',
    'vscode  - VS Code / Cursor / vscode-family editors',
    'pycharm - PyCharm / DataSpell',
    'jupyter - JupyterLab (real-time collaboration)',
  ]],
  ['--help, -h', ['Show this help and exit.']],
];

const HELP_EXAMPLES = [
  ['lemma', 'configure every detected agent'],
  ['lemma --dry-run', 'preview changes without writing'],
  ['lemma --only cursor', 'configure just Cursor'],
  ['lemma --configure vscode', 'only register the vscode_* notebook tools'],
  ['lemma --uninstall', 'remove Lemma from every detected agent'],
  ['lemma --only codex --uninstall', 'remove Lemma from just Codex'],
];

function formatColumns(rows, indent) {
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows
    .map(([left, lines]) => {
      const body = Array.isArray(lines) ? lines : [lines];
      return body
        .map((line, i) => `${indent}${(i === 0 ? left : '').padEnd(width)}  ${line}`)
        .join('\n');
    })
    .join('\n');
}

function printHelp() {
  console.log(`
Lemma installer

Detects installed AI agents/editors and configures each with the Lemma
MCP server, persona, and skills in one pass. Run with no options to
configure every agent found.

Usage: lemma [options]

Options:
${formatColumns(HELP_OPTIONS, '  ')}

Examples:
${formatColumns(HELP_EXAMPLES, '  ')}
`);
}

// ---- main -------------------------------------------------------------------

function main() {
  if (HELP) {
    printHelp();
    return;
  }

  console.log(`\nLemma installer${DRY_RUN ? ' (dry-run)' : ''}${UNINSTALL ? ' — uninstalling' : ''}\n`);

  if (CONFIGURE && !CONFIGURE_SURFACES.includes(CONFIGURE)) {
    console.error(`Unknown --configure surface: ${CONFIGURE}. Valid: ${CONFIGURE_SURFACES.join(', ')}`);
    process.exit(1);
  }

  const cmd = lemmaMcpCommand();
  if (CONFIGURE) {
    cmd.push(`--surface=${CONFIGURE}`);
  }
  console.log(`lemma-mcp command: ${cmd.join(' ')}\n`);

  const providers = makeProviders(cmd);
  const targets = ONLY
    ? providers.filter((p) => p.id === ONLY)
    : providers;

  if (ONLY && targets.length === 0) {
    console.error(`Unknown agent: ${ONLY}. Valid ids: ${providers.map((p) => p.id).join(', ')}`);
    process.exit(1);
  }

  let count = 0;
  for (const provider of targets) {
    if (!provider.detect()) {
      skip(provider.label, 'not detected');
      continue;
    }
    log(`${UNINSTALL ? 'Uninstalling' : 'Installing'}: ${provider.label}`);
    if (UNINSTALL) {
      provider.uninstall();
      if (provider.skillsDir) removeSkillsFrom(provider.skillsDir);
    } else {
      provider.install();
      if (provider.skillsDir) copySkillsTo(provider.skillsDir);
    }
    ok(provider.label);
    count++;
  }

  if (!ONLY || ONLY === 'claude-code') {
    log(`\n${UNINSTALL ? 'Removing' : 'Installing'} hooks (global):`);
    if (UNINSTALL) { uninstallHooks(); } else { installHooks(); }

    log(`\n${UNINSTALL ? 'Removing' : 'Installing'} vscode_* permission allow-list (global):`);
    if (UNINSTALL) { uninstallPermissions(); } else { installPermissions(); }
  }

  // The editor extension is per-editor, not per-agent: run it on a full install
  // or when targeting an editor agent specifically.
  if (!ONLY || ONLY === 'cursor' || ONLY === 'vscode') {
    log(`\n${UNINSTALL ? 'Removing' : 'Installing'} editor extension (vscode_* surface):`);
    if (UNINSTALL) { uninstallExtension(); } else { installExtension(); }
  }

  console.log(`\n${count} agent(s) ${UNINSTALL ? 'uninstalled' : 'configured'}.`);
  if (!UNINSTALL && count === 0) {
    console.log('No agents detected. Use --only <id> to force-install.');
    console.log(`Available: ${providers.map((p) => p.id).join(', ')}`);
  }
}

main();
