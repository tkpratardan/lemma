# Changelog

All notable changes to Lemma are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/). Each release is a git tag `vX.Y.Z`;
pushing the tag runs the publish workflow (see CONTRIBUTING.md). Add entries to
`Unreleased` as you go, and move them under a dated version heading at release.

## [Unreleased]

### Changed

- Surface configuration now selects only the lazy-attachment preference. All
  notebook adapters remain available, and `connect(surface=...)` can switch
  surfaces mid-session without resetting the kernel or discarding turn evidence.

## [3.1.2] - 2026-07-09

First release.

### Added

- Senior data-scientist persona (`AGENTS.md`), delivered to every detected host at connect time: name the question's mode first, baseline before a complex model, deployment-shaped splits, never evaluate on training data, set a seed. It layers on top of a repo's own conventions instead of replacing them.
- Live-notebook MCP tools across three surfaces, driven wherever a notebook is live: `vscode_*` (VS Code / Cursor editor), and `pycharm_*` / `jupyterlab_*` connect tools plus shared `notebook_*` verbs (on-disk `.ipynb` + kernel for PyCharm, real-time collaboration for JupyterLab, no plugin needed for either). The agent probes actual kernel state instead of guessing at what a prior cell produced.
- 8 question-mode skills: `lemma-eda`, `lemma-baseline`, `lemma-describe`, `lemma-inference`, `lemma-causal`, `lemma-unsupervised`, `lemma-leakage`, and `lemma-review`, so the mode picks the method instead of applying predict-track rigor to a causal or descriptive question.
- One-command install (`bin/install.js`) that configures every detected agent across 10 hosts (Claude Code, Cursor, VS Code, Windsurf, Claude Desktop, Codex, GitHub Copilot CLI, Antigravity / Gemini CLI, opencode, OpenClaw), delivering the MCP tools, the persona, and, where the host supports them, the skills and hooks. `lemma --configure vscode|pycharm|jupyter` restricts a host to one notebook surface instead of registering all three.
- A `vscode_*` auto-allow list on hosts that support one (Claude Code, Cursor, Codex, opencode, Windsurf, Claude Desktop), so the editor's own confirm-diff gate is the only prompt for that surface instead of a redundant second one from the host.
- A human-in-the-loop permission gate in VS Code/Cursor: every AI edit renders as a diff with Accept / Always Allow / Discard controls (editor-title-bar buttons and status bar items), so the agent can act autonomously without acting unsupervised.
- `lemma_skill(name)`: an MCP tool returning one skill's full ruleset, so hosts with no native skill support can still pull the mode rulesets the persona routes to.
- `lemma-model` skill: final-modeling rigor once the baseline and features are locked, rounding the routing table out to 9 modes.
- Production rigor added to every skill: renaming uninferrable columns from data dictionaries, join-introduced silent failure checks, reusable feature logic instead of ad-hoc columns, guardrail metrics on causal claims, a leakage correlation threshold, a join time-travel check, and a shared rule against inventing business figures that aren't backed by data or user input.
- Claude Code, Codex, Copilot, Antigravity, and OpenClaw now install as a plugin pointed at the published GitHub repo instead of a local copy, so a git push is what ships an update. Claude Code and Gemini CLI auto-update in the background; the rest use the host's own update command instead of lemma's installer.

### Fixed

- Missing `owner` field in the Claude Code marketplace manifest, which made `claude plugin marketplace add` fail outright.
- Wrong CLI verbs for Codex (`install`/`uninstall` instead of `add`/`remove`) and Copilot (`remove` instead of `uninstall`).
- Copilot was delivering the persona twice, once through its session-start hook and once through MCP instructions.
- MCP server paths in plugin manifests now use `${CLAUDE_PLUGIN_ROOT}` / `${PLUGIN_ROOT}` instead of a bare relative path, which only worked by coincidence.
- `bin/install.js` could write an incomplete `extraKnownMarketplaces` entry to `~/.claude/settings.json` when `marketplace add` failed, breaking the whole settings file.
- VS Code/Cursor status bar buttons for the accept/discard gate collided with built-in items; moved them to the left-aligned, high-priority group.
- Claude Code's vscode_* permission allow-list and hook cleanup lived in a separate step gated only by `--only`, not by whether Claude Code was actually detected — so a full install on a machine with no `claude` CLI still wrote to `~/.claude/settings.json`. Moved both into the Claude Code provider's own install/uninstall, matching every other host; the allow-list also now only writes when lemma was actually registered (plugin install or fallback), not unconditionally.
- Every plugin-route host (Claude Code, Codex, Copilot, Antigravity, Gemini CLI) installs via a git fetch with no `node_modules`, so the compiled MCP server crashed on startup and registered no tools at all. `zod` was also never declared as its own dependency. Fixed by bundling the server into a dependency-free `bin/lemma-mcp.mjs`; every plugin manifest and `bin/install.js`'s local-install fallback now point at that instead of `src/dist/`.
