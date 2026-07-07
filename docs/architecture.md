# Architecture

A high-level map of the repo: where things live and how the pieces fit
together. Implementation specifics live in the code itself, not here.

## Directory map

- `AGENTS.md`: the persona. Single source of truth for lemma's rigor rules;
  every delivery channel below reads or copies from this one file.
- `src/`: the MCP server (TypeScript), compiled and bundled into `bin/lemma-mcp.mjs`.
  - `src/mcp/server.ts`: entry point, tool registration, persona loading.
  - `src/adapters/`: one adapter per notebook surface, plus shared utilities.
  - `src/utils/`: shared, pure helper functions used across adapters.
- `bin/`: what actually ships and runs (`install.js`, the bundled MCP server).
- `hooks/`: lifecycle scripts (persona delivery, a couple of small session
  behaviors) and per-host manifests wiring them up.
- `skills/`: nine question-mode rulesets, one per kind of analysis question.
- `extensions/vscode/`: the companion editor extension.
- `scripts/`: repo maintenance, not shipped to end users.
- Plugin manifests for each host's own plugin system, plus generated,
  read-only persona copies for hosts with no other delivery channel.
- `docs/`: this file, a tool reference, and a changelog.

## The MCP server

One process, `bin/lemma-mcp.mjs`, is what every host actually spawns. At
startup it loads the persona, decides how to surface it (a host may already
deliver it another way, so it isn't sent twice), and registers tools scoped
to whichever notebook surface is configured, or all of them if none is
specified.

## Notebook surfaces

Lemma drives a live notebook across three surfaces, VS Code/Cursor, PyCharm,
and JupyterLab, each through whatever mechanism that host actually exposes.
The details differ by necessity (PyCharm has no public API to drive its UI
at all; JupyterLab and VS Code each expose something different), but the
result is the same from the agent's side: read what's actually running,
edit and execute it, get a normalized result back. Verbs that behave
identically across surfaces are registered once, not duplicated per surface.

## Build

`src/` compiles and bundles into a single dependency-free file. This exists
because most hosts install lemma via a plain git fetch with no install step,
so the shipped binary can't depend on anything not already inside it.

## Delivering the persona

`AGENTS.md` reaches an agent through whichever channel that host actually
supports: as MCP connection metadata, via a session-lifecycle hook, or as a
generated, host-specific copy for hosts with neither. Which channel applies
is decided per host, so the same rules reach every agent without being
hand-copied and drifting out of sync.

## Skills

Each skill is a self-contained ruleset for one kind of analysis question.
Hosts that scan a skills directory natively get them copied in at install
time; everyone else can pull the same ruleset through an MCP tool instead.

## The installer

One entry per supported host, each knowing how to detect that host and how
to register (and later remove) the MCP server, skills, hooks, and any
permission allow-list that host supports. Running the installer walks that
list once; uninstalling reverses it.

## Putting it together

Install once, and every session that host starts gets the persona through
whatever channel it has, drives whichever notebook surface is live through
lemma's tools, and gets a consistent, normalized result back regardless of
which surface handled it.
