#!/usr/bin/env node
// Lemma installer: one command auto-detects and configures every installed
// agent. Writes only user-level (global) configs, never project files.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
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
// Hosts with a native plugin system get pointed at the published repo so
// their own manager owns fetching/updating. LEMMA_DEV_LOCAL=1 swaps in this
// checkout, so testing a change doesn't need a push round-trip.

const LEMMA_GITHUB_REPO = 'tkpratardan/lemma';
const LEMMA_GITHUB_URL = `https://github.com/${LEMMA_GITHUB_REPO}`;
const DEV_LOCAL = Boolean(process.env.LEMMA_DEV_LOCAL);

// owner/repo or URL, for CLIs whose marketplace/install commands take a bare
// string source (Codex, Copilot, agy, Gemini) — local path in dev mode.
function pluginSource() {
  return DEV_LOCAL ? REPO_ROOT : LEMMA_GITHUB_URL;
}

const HELP = ARGS.flags.has('help') || process.argv.includes('-h');
const PACKAGE_VERSION = require(path.join(REPO_ROOT, 'package.json')).version;

function isNewerVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

async function checkForUpdate() {
  try {
    const res = await fetch('https://registry.npmjs.org/@tkpratardan/lemma/latest', {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return;
    const { version: latest } = await res.json();
    if (latest && isNewerVersion(latest, PACKAGE_VERSION)) {
      console.log(
        `Update available: ${PACKAGE_VERSION} → ${latest}. Run \`npm install -g @tkpratardan/lemma@latest\` to update.\n`
      );
    }
  } catch {
    // offline or registry unreachable — never blocks the install
  }
}

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

function askYesNo(question) {
  if (DRY_RUN || !process.stdin.isTTY) return Promise.resolve(false);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (y/n) `, (answer) => {
      rl.close();
      resolve(/^y/i.test(answer.trim()));
    });
  });
}

// ---- resolve lemma-mcp command ---------------------------------------------

function lemmaMcpCommand() {
  const onPath = which('lemma-mcp');
  if (onPath) return ['lemma-mcp'];
  const bundled = path.join(__dirname, 'lemma-mcp.mjs');
  if (fs.existsSync(bundled)) return ['node', bundled];
  return ['lemma-mcp'];
}

// ---- Codex plugin install ---------------------------------------------------
// Points Codex's own plugin manager at the published repo (or this checkout
// under LEMMA_DEV_LOCAL); it owns fetching from here on, not this installer.

const CODEX_MARKETPLACE_NAME = 'lemma';

function codexPluginSelector() {
  return `lemma@${CODEX_MARKETPLACE_NAME}`;
}

// Logs one host-CLI action and runs it unless DRY_RUN. `warnLabel` downgrades
// a failure to a logged warning so one host's breakage never blocks the
// others; omit it where the old behavior ignored failures (uninstall paths).
function runCliStep(cli, logText, args, warnLabel) {
  log(`  ${logText}`);
  if (DRY_RUN) return;
  const r = spawnSync(cli, args, { encoding: 'utf8', timeout: 60000 });
  if (warnLabel && (r.status !== 0 || r.error)) {
    const reason = (r.stderr || r.stdout || r.error?.message || 'unknown').trim();
    log(`  warning: ${warnLabel} failed: ${reason}`);
  }
}

function installCodexPlugin() {
  const cli = codexCli();
  if (!cli) {
    log('  warning: codex CLI not found; skipping');
    return;
  }
  runCliStep(cli, `codex plugin marketplace add ${pluginSource()}`,
    ['plugin', 'marketplace', 'add', pluginSource()], 'codex plugin marketplace add');
  runCliStep(cli, `codex plugin add ${codexPluginSelector()}`,
    ['plugin', 'add', codexPluginSelector()], 'codex plugin add');
}

function uninstallCodexPlugin() {
  const cli = codexCli();
  if (!cli) {
    log('  warning: codex CLI not found; nothing to uninstall');
    return;
  }
  runCliStep(cli, `codex plugin remove ${codexPluginSelector()}`,
    ['plugin', 'remove', codexPluginSelector()]);
  runCliStep(cli, `codex plugin marketplace remove ${CODEX_MARKETPLACE_NAME}`,
    ['plugin', 'marketplace', 'remove', CODEX_MARKETPLACE_NAME]);
  removeCodexHookTrustState();
}

function removeCodexHookTrustState() {
  const file = codexConfigTomlPath();
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch { return; }
  const selector = codexPluginSelector().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\[hooks\\.state\\."${selector}:[^\\]]*"\\]\\n(?:[^\\n[][^\\n]*\\n)*\\n?`, 'g');
  const stripped = content.replace(pattern, '');
  if (stripped === content) return;
  log(`  remove hook-trust state for ${codexPluginSelector()} from ${file}`);
  if (!DRY_RUN) {
    fs.writeFileSync(file, stripped);
  }
}

// ---- Copilot CLI plugin install ---------------------------------------------
// Confirmed against the real CLI: `marketplace add <source>` takes owner/repo,
// URL, or local path directly, and the uninstall verb is `uninstall`, not
// `remove`. Hooks fire for Copilot, and for Codex after a one-time trust step.

const COPILOT_MARKETPLACE_NAME = 'lemma';
const COPILOT_PLUGIN_SELECTOR = 'lemma@lemma'; // name@marketplace, both "lemma" per .github/plugin/marketplace.json

function installCopilotPlugin() {
  const cli = which('copilot');
  if (!cli) {
    log('  warning: copilot CLI not found; skipping');
    return;
  }
  runCliStep(cli, `copilot plugin marketplace add ${pluginSource()}`,
    ['plugin', 'marketplace', 'add', pluginSource()], 'copilot plugin marketplace add');
  runCliStep(cli, `copilot plugin install ${COPILOT_PLUGIN_SELECTOR}`,
    ['plugin', 'install', COPILOT_PLUGIN_SELECTOR], 'copilot plugin install');
}

function uninstallCopilotPlugin() {
  const cli = which('copilot');
  if (!cli) {
    log('  warning: copilot CLI not found; nothing to uninstall');
    return;
  }
  runCliStep(cli, `copilot plugin uninstall ${COPILOT_PLUGIN_SELECTOR}`,
    ['plugin', 'uninstall', COPILOT_PLUGIN_SELECTOR], 'copilot plugin uninstall');
  runCliStep(cli, `copilot plugin marketplace remove ${COPILOT_MARKETPLACE_NAME}`,
    ['plugin', 'marketplace', 'remove', COPILOT_MARKETPLACE_NAME]);
}

// ---- OpenClaw plugin install -------------------------------------------------
// `openclaw plugins install --marketplace` reads the same `.claude-plugin/`
// manifest Claude Code uses — no ClawHub publish needed. `--force` skips the
// interactive y/N confirm, which otherwise fails outside a TTY.

function installOpenclawPlugin() {
  const cli = which('openclaw');
  if (!cli) {
    log('  warning: openclaw CLI not found; skipping');
    return;
  }
  runCliStep(cli, `openclaw plugins install lemma --marketplace ${pluginSource()}`,
    ['plugins', 'install', 'lemma', '--marketplace', pluginSource(), '--force'],
    'openclaw plugins install');
}

function uninstallOpenclawPlugin() {
  const cli = which('openclaw');
  if (!cli) {
    log('  warning: openclaw CLI not found; nothing to uninstall');
    return;
  }
  runCliStep(cli, 'openclaw plugins uninstall lemma --force',
    ['plugins', 'uninstall', 'lemma', '--force']);
}

// ---- OpenClaw bootstrap file install ------------------------------------------
// AGENTS.md is a documented OpenClaw workspace bootstrap file. Marker-fenced
// so uninstall only touches lemma's block, never the user's own content.

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
// ~/.cursor/hooks.json is a plain global config (cursor.com/docs/hooks), so
// this merges in directly — no plugin marketplace involved.

// Each Cursor hook event lemma wires up, the shared script it runs, and the
// pre-3.2 per-host script name a re-install must still replace.
const CURSOR_HOOKS = [
  { event: 'sessionStart', script: 'session-start.js', legacy: 'cursor-session-start.js' },
  { event: 'beforeSubmitPrompt', script: 'prompt-submit.js', legacy: 'cursor-clear-discard.js' },
  { event: 'afterMCPExecution', script: 'post-tool-use.js', legacy: 'cursor-detect-discard.js' },
  { event: 'beforeMCPExecution', script: 'pre-tool-use.js', legacy: 'cursor-deny-if-discarded.js' },
  { event: 'beforeShellExecution', script: 'pre-tool-use.js', legacy: 'cursor-deny-if-discarded.js' },
  { event: 'beforeReadFile', script: 'pre-tool-use.js', legacy: 'cursor-deny-if-discarded.js' },
];

function cursorHooksPath() {
  return path.join(HOME, '.cursor', 'hooks.json');
}

// Matches by script filename, not object equality, so re-install replaces
// lemma's entry instead of appending a duplicate each time.
function isCursorLemmaHook(...scripts) {
  return (entry) => Boolean(entry) && typeof entry.command === 'string' &&
    scripts.some((script) => entry.command.includes(script));
}

function installCursorHook() {
  const filePath = cursorHooksPath();
  log(`  install hooks → ${filePath}`);
  if (DRY_RUN) return;

  let config = {};
  try { config = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { }
  config.version = config.version || 1;
  config.hooks = config.hooks || {};
  for (const { event, script, legacy } of CURSOR_HOOKS) {
    const existing = Array.isArray(config.hooks[event]) ? config.hooks[event] : [];
    const entry = {
      command: `node "${path.join(REPO_ROOT, 'hooks', script)}" --host=cursor`,
      timeout: 5,
    };
    config.hooks[event] = existing.filter((h) => !isCursorLemmaHook(script, legacy)(h));
    config.hooks[event].push(entry);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n');
}

function uninstallCursorHook() {
  for (const { event, script, legacy } of CURSOR_HOOKS) {
    removeFromArrayInJson(cursorHooksPath(), `hooks.${event}`, isCursorLemmaHook(script, legacy));
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
  const commandFor = (defaultSurface) => {
    if (!defaultSurface || cmd.some((arg) => arg.startsWith('--surface='))) return cmd;
    return [...cmd, `--surface=${defaultSurface}`];
  };
  const entryFor = (defaultSurface) => {
    const selected = commandFor(defaultSurface);
    return { command: selected[0], ...(selected.length > 1 ? { args: selected.slice(1) } : {}) };
  };
  const mcpEntry = entryFor();
  const vscodeMcpEntry = entryFor('vscode');

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
          mcpServers: { lemma: vscodeMcpEntry },
        });
        installCursorHook();
        installPermissionsFor('cursor');
      },
      uninstall() {
        removeFromJson(path.join(HOME, '.cursor', 'mcp.json'), 'mcpServers.lemma');
        uninstallCursorHook();
        uninstallPermissionsFor('cursor');
      },
    },
    {
      id: 'vscode',
      label: 'VS Code',
      detect: () => Boolean(which('code')),
      install() {
        const entry = { type: 'stdio', ...vscodeMcpEntry };
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
      async install() {
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
        let pluginInstalled = DRY_RUN;
        log(`  claude plugin install lemma@lemma`);
        if (!DRY_RUN) {
          const installed = spawnSync(cli, ['plugin', 'install', 'lemma@lemma'], { encoding: 'utf8', timeout: 60000 });
          if (installed.status !== 0 || installed.error) {
            const reason = (installed.stderr || installed.stdout || installed.error?.message || 'unknown').trim();
            log(`  warning: claude plugin install failed: ${reason}`);
          } else {
            pluginInstalled = true;
          }
        }

        let fallbackUsed = false;
        if (!marketplaceAdded || !pluginInstalled) {
          const fallback = await askYesNo('  Plugin install failed. Fall back to a direct config write (skills/MCP/hooks, no auto-update)?');
          if (fallback) {
            log('  falling back to direct config write');
            writeJsonMerge(path.join(HOME, '.claude.json'), { mcpServers: { lemma: mcpEntry } });
            copySkillsTo(path.join(HOME, '.claude', 'skills'));
            installHooks();
            fallbackUsed = true;
          }
        }

        // Only when lemma is actually registered one way or the other —
        // otherwise there's nothing here to allow-list.
        if (pluginInstalled || fallbackUsed) {
          installPermissionsFor('claude');
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
        removeSkillsFrom(path.join(HOME, '.claude', 'skills'));
        uninstallHooks();
        uninstallPermissionsFor('claude');
        // `claude plugin uninstall` doesn't clear these — a leftover cache/flag
        // makes an already-running session look like the plugin never left.
        for (const stale of [
          path.join(HOME, '.claude', '.lemma-active'),
          path.join(HOME, '.lemma'),
          path.join(HOME, '.claude', 'plugins', 'cache', 'lemma'),
          path.join(HOME, '.claude', 'plugins', 'marketplaces', 'lemma'),
        ]) {
          if (!fs.existsSync(stale)) continue;
          log(`  remove ${stale}`);
          if (!DRY_RUN) fs.rmSync(stale, { recursive: true, force: true });
        }
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
        writeJsonMerge(file, { mcpServers: { lemma: vscodeMcpEntry } });
        addToArrayInJson(file, 'mcpServers.lemma.alwaysAllow', CANONICAL_TOOL_NAMES);
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
      postInstallNote: 'run /hooks to review and trust lemma\'s lifecycle hooks (Codex skips them until reviewed)',
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
          installPermissionsFor('antigravity');
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
          uninstallPermissionsFor('antigravity');
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
        // injects AGENTS.md into every request's system prompt. An
        // `instructions` entry would put a second copy of the persona in the same request, so none is
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
        // paths (the same values install() wrote), leaving any other entry
        // untouched.
        const agentsPath = path.join(REPO_ROOT, 'AGENTS.md');
        const pluginSuffix = path.join('.opencode', 'plugins', 'lemma.mjs');
        removeFromArrayInJson(configFile, 'instructions', (v) => v === agentsPath);
        removeFromArrayInJson(configFile, 'plugin', (v) => v.endsWith(pluginSuffix));
        uninstallOpencodePermissions();
      },
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      detect: () => appExists('Windsurf') || Boolean(which('windsurf')),
      install() {
        const file = path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json');
        writeJsonMerge(file, { mcpServers: { lemma: vscodeMcpEntry } });
        addToArrayInJson(file, 'mcpServers.lemma.alwaysAllow', CANONICAL_TOOL_NAMES);
      },
      uninstall() {
        removeFromJson(path.join(HOME, '.codeium', 'windsurf', 'mcp_config.json'), 'mcpServers.lemma');
      },
    },
  ];
}

// ---- hooks (fallback path when the plugin install fails) -------------------

function installHooks() {
  const hooksSource = path.join(__dirname, '..', 'hooks', 'hooks.json');
  if (!fs.existsSync(hooksSource)) return;
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
// Skills are discovered by directory scan, so unlike MCP/persona/hooks they
// must be physically copied into each provider's global `skillsDir`.
// Windsurf only documents a *project* skills dir, so it stays unwired.

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
    if (!fs.existsSync(dest)) continue;
    log(`  remove ${dest}`);
    if (!DRY_RUN) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }
}

// ---- permissions (Claude Code's global settings) ----------------------------

const CANONICAL_TOOL_NAMES = [
  'connect', 'read', 'run', 'edit', 'inspect', 'checkpoint',
  'verify_clean_run', 'publish_answer',
];

// Claude Code names a plugin-installed server's tools
// mcp__plugin_<plugin>_<marketplace>__<tool>, not the plain mcp__lemma__<tool>
// the direct-config-write fallback uses. Both are written, since either
// registration path might be the one active.
const CLAUDE_MCP_PREFIXES = ['lemma', 'plugin_lemma_lemma'];

// One row per host that pre-approves the canonical notebook actions in a JSON allowlist:
// where the list lives, and how that host spells a tool entry. Entry formats
// confirmed per host: cursor.com/docs/reference/permissions ("<server>:<tool>"
// in mcpAllowlist); Antigravity uses "mcp(<server>/<tool>)".
const PERMISSION_TARGETS = {
  claude: {
    file: () => path.join(HOME, '.claude', 'settings.json'),
    keyPath: 'permissions.allow',
    entries: () => CLAUDE_MCP_PREFIXES.flatMap((prefix) =>
      CANONICAL_TOOL_NAMES.map((name) => `mcp__${prefix}__${name}`)),
    logInstall: true,
    pruneEmptyParent: true,
  },
  cursor: {
    file: () => path.join(HOME, '.cursor', 'permissions.json'),
    keyPath: 'mcpAllowlist',
    entries: () => CANONICAL_TOOL_NAMES.map((name) => `lemma:${name}`),
  },
  antigravity: {
    file: () => path.join(HOME, '.gemini', 'antigravity-cli', 'settings.json'),
    keyPath: 'permissions.allow',
    entries: () => CANONICAL_TOOL_NAMES.map((name) => `mcp(lemma/${name})`),
  },
};

function installPermissionsFor(hostId) {
  const target = PERMISSION_TARGETS[hostId];
  if (target.logInstall) {
    log(`  allow-list canonical notebook actions → ${target.file()} (global)`);
  }
  addToArrayInJson(target.file(), target.keyPath, target.entries());
}

function uninstallPermissionsFor(hostId) {
  const target = PERMISSION_TARGETS[hostId];
  const lemmaVscodeTools = new Set(target.entries());
  removeFromArrayInJson(target.file(), target.keyPath, (item) => lemmaVscodeTools.has(item));
  if (!target.pruneEmptyParent) return;
  // Drop a vestigial empty `"permissions": {}` left behind when allow was the
  // only key present (mirrors uninstallHooks' equivalent cleanup).
  try {
    const settings = JSON.parse(fs.readFileSync(target.file(), 'utf8'));
    if (settings.permissions && Object.keys(settings.permissions).length === 0) {
      delete settings.permissions;
      if (!DRY_RUN) fs.writeFileSync(target.file(), JSON.stringify(settings, null, 2) + '\n');
    }
  } catch { /* file missing or unparsable — nothing to clean */ }
}

// opencode.ai/docs/permissions: MCP tools are named `<server>_<tool>` and
// permission patterns support wildcards, so one rule covers the action surface.
function installOpencodePermissions() {
  const file = path.join(HOME, '.config', 'opencode', 'opencode.json');
  writeJsonMerge(file, { permission: { 'lemma_*': 'allow' } });
}

function uninstallOpencodePermissions() {
  const file = path.join(HOME, '.config', 'opencode', 'opencode.json');
  removeFromJson(file, 'permission.lemma_*');
}

const CODEX_TOML_START = '# --- lemma canonical tool approvals (managed by lemma installer) ---';
const CODEX_TOML_END = '# --- end lemma canonical tool approvals ---';

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
    ...CANONICAL_TOOL_NAMES.map((name) => `[${base}.tools.${name}]\napproval_mode = "approve"`),
  ];
  const withBlock = `${content.replace(/\n*$/, '\n')}\n${CODEX_TOML_START}\n${tables.join('\n\n')}\n${CODEX_TOML_END}\n`;
  log(`  write canonical tool approvals → ${file}`);
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
  log(`  remove canonical tool approvals from ${file}`);
  if (!DRY_RUN) {
    fs.writeFileSync(file, stripped);
  }
}

// ---- editor extension (the VS Code surface backend) -------------------------
// The canonical actions need the Lemma editor extension on this backend; install it via the
// editor CLIs. Source: $LEMMA_VSIX (local build) or the marketplace id.
// `cursor --install-extension` rejects the id even though it's listed on
// Cursor's marketplace mirror — a moderation gate outside lemma's control
// (docs/INSTALL.md); that failure is a logged warning, not fatal.

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
  for (const dir of [path.join(HOME, '.vscode', 'extensions'), path.join(HOME, '.cursor', 'extensions')]) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries.filter((n) => n.startsWith(`${EXTENSION_ID}-`))) {
      log(`  remove ${path.join(dir, name)}`);
      if (!DRY_RUN) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
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
    'Set the preferred surface for lazy notebook attachment.',
    'All three surfaces remain available through connect(surface=...).',
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
  ['lemma --configure vscode', 'route canonical notebook actions to VS Code'],
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

async function main() {
  if (HELP) {
    printHelp();
    return;
  }

  if (!UNINSTALL) {
    await checkForUpdate();
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
  const postInstallNotes = [];
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
      await provider.install();
      if (provider.skillsDir) copySkillsTo(provider.skillsDir);
      if (provider.postInstallNote) postInstallNotes.push(`${provider.label}: ${provider.postInstallNote}`);
    }
    ok(provider.label);
    count++;
  }

  // The editor extension is per-editor, not per-agent: run it on a full install
  // or when targeting an editor agent specifically.
  if (!ONLY || ONLY === 'cursor' || ONLY === 'vscode') {
    log(`\n${UNINSTALL ? 'Removing' : 'Installing'} editor extension (VS Code surface):`);
    if (UNINSTALL) { uninstallExtension(); } else { installExtension(); }
  }

  console.log(`\n${count} agent(s) ${UNINSTALL ? 'uninstalled' : 'configured'}.`);
  if (!UNINSTALL && count === 0) {
    console.log('No agents detected. Use --only <id> to force-install.');
    console.log(`Available: ${providers.map((p) => p.id).join(', ')}`);
  }
  if (!UNINSTALL && count > 0) {
    console.log('\nVerify hooks actually fire before relying on them (start a fresh session and confirm the persona loads):');
    for (const note of postInstallNotes) console.log(`  - ${note}`);
    if (postInstallNotes.length === 0) console.log('  - no extra steps known for the agents just configured');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
