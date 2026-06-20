# Changelog

All notable changes to Lemma are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/). Each release is a git tag `vX.Y.Z`;
pushing the tag runs the publish workflow (see CONTRIBUTING.md). Add entries to
`Unreleased` as you go, and move them under a dated version heading at release.

## [Unreleased]

## [3.1.1] - 2026-07-05

First release.

### Added

- Senior data-scientist persona (`AGENTS.md`), delivered to every detected host at connect time: name the question's mode first, baseline before a complex model, deployment-shaped splits, never evaluate on training data, set a seed. It layers on top of a repo's own conventions instead of replacing them.
- Live-notebook MCP tools across three surfaces, driven wherever a notebook is live: `vscode_*` (VS Code / Cursor editor), and `pycharm_*` / `jupyterlab_*` connect tools plus shared `notebook_*` verbs (on-disk `.ipynb` + kernel for PyCharm, real-time collaboration for JupyterLab, no plugin needed for either). The agent probes actual kernel state instead of guessing at what a prior cell produced.
- 8 question-mode skills: `lemma-eda`, `lemma-baseline`, `lemma-describe`, `lemma-inference`, `lemma-causal`, `lemma-unsupervised`, `lemma-leakage`, and `lemma-review`, so the mode picks the method instead of applying predict-track rigor to a causal or descriptive question.
- One-command install (`bin/install.js`) that configures every detected agent across 10 hosts (Claude Code, Cursor, VS Code, Windsurf, Claude Desktop, Codex, GitHub Copilot CLI, Antigravity / Gemini CLI, opencode, OpenClaw), delivering the MCP tools, the persona, and, where the host supports them, the skills and hooks. `lemma --configure vscode|pycharm|jupyter` restricts a host to one notebook surface instead of registering all three.
- A `vscode_*` auto-allow list on hosts that support one (Claude Code, Cursor, Codex, opencode, Windsurf, Claude Desktop), so the editor's own confirm-diff gate is the only prompt for that surface instead of a redundant second one from the host.
- A human-in-the-loop permission gate in VS Code/Cursor: every AI edit renders as a diff with Accept / Always Allow / Discard controls (editor-title-bar buttons and status bar items), so the agent can act autonomously without acting unsupervised.
- `lemma_skill(name)`: an MCP tool returning one skill's full ruleset, so hosts with no native skill support can still pull the mode rulesets the persona routes to.
