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
- `skills/`: ten compact analytical checklists with progressively disclosed
  references and deterministic notebook-callable helpers.
- `extensions/vscode/`: the companion editor extension.
- `scripts/`: repo maintenance, not shipped to end users.
- Plugin manifests for each host's own plugin system, plus generated,
  read-only persona copies for hosts with no other delivery channel.
- `docs/`: this file, a tool reference, and a changelog.

## The MCP server

One process, `bin/lemma-mcp.mjs`, is what every host actually spawns. At
startup it loads the persona, decides how to surface it (a host may already
deliver it another way, so it isn't sent twice), and registers the canonical
five-action analysis interface. The launch surface is only a preference for
lazy attachment; every adapter remains available. `connect(surface=...)`
switches the active surface without restarting the MCP process or kernel, while
`reset_kernel=true` makes a restart explicit. Backend-specific verbs stay hidden.

## Notebook surfaces

Lemma drives a live notebook across three surfaces, VS Code/Cursor, PyCharm,
and JupyterLab, each through whatever mechanism that host actually exposes.
The details differ by necessity (PyCharm has no public API to drive its UI
at all; JupyterLab and VS Code each expose something different), but the
result is the same from the agent's side. `run` returns the execution result
and a compact state delta together, including changed variables, warnings,
errors, and a pointer to full output.

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

Each skill's immediately loaded procedure is a short deliverable-and-checklist
contract. Detailed theory lives in `references/`; deterministic helpers live
in `scripts/`. Hosts that scan a skills directory get the whole folder. Other
clients fetch these progressively through the `lemma_skill` MCP prompt rather
than adding a ninth action tool.

## Passive evidence ledger

The first notebook action opens a project-scoped namespace under
`~/.lemma/tasks`. A prompt hook supplies a bounded turn label, not conversation
history. The ledger automatically records notebook identity, inspected targets,
executed cell ids and hashes, outputs, errors, sources, and recognizable written
artifacts. Optional facts, assumptions, risks, and audit receipts can supplement
that mechanical evidence. When a turn switches surfaces, notebook identities
and surface-qualified cell evidence remain in the same ledger. Nothing in the
ledger controls action order or count.
Source requests can be batched; their first durable cell installs the inspection
helper and later cells invoke it compactly.

Hooks enforce only mechanics: raw inputs remain immutable, shell-based data
computation cannot bypass an activated notebook, discarded edits stop work,
and unresolved execution errors cannot be presented as clean completion. A
stop hook checks for notebook evidence and a chat answer, but its outcome
reminder fires only once and never dictates the next tool call.
Analytical planning and judgment stay with the model, guided by the thin persona
and the relevant skill checklist rather than a workflow controller.

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
