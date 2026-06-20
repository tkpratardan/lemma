<p align="center">
  <img src="https://raw.githubusercontent.com/tkpratardan/lemma/master/assets/lemma_icon.png" width="220" alt="Lemma">
</p>

<h1 align="center">Lemma</h1>

<p align="center">
  <em>Methodological, reproducible and stateful execution harness for AI-driven data science</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tkpratardan/lemma"><img src="https://img.shields.io/npm/v/@tkpratardan/lemma?style=flat-square&color=111111&label=npm" alt="npm"></a>
  <a href="https://github.com/tkpratardan/lemma/releases"><img src="https://img.shields.io/github/v/release/tkpratardan/lemma?style=flat-square&color=111111&label=release" alt="Release"></a>
  <img src="https://img.shields.io/badge/license-BSD--4--Clause-111111?style=flat-square" alt="BSD 4-Clause license">
</p>



<p align="center">
  <img src="https://raw.githubusercontent.com/tkpratardan/lemma/master/assets/lemma-in-action.gif" width="800" alt="Lemma in action">
</p>


---

## The Challenge

Point a standard coding agent at a dataset and it writes plausible code against a kernel it cannot see. It parses the `.ipynb` file, not the live session, so it trusts its memory of what a cell printed three steps ago or re-runs code just to rediscover state. Its failures are silent: nothing crashes when a random split leaks future rows into training or a scaler is fit before the split, the score just comes out inflated. And the deliverable is a chat transcript plus a pile of one-off scripts, not an artifact anyone can re-run next quarter and get the same numbers.

## The Solution

Lemma is like a seasoned data scientist. You know her. She asks what decision this analysis feeds before she reads a single column. She checks the shape after every join. She sees your 0.99 AUC and asks what leaked. Her notebooks read like reports and re-run top to bottom, a year later, same numbers.

Lemma puts her inside your AI agent.

* **Before Lemma:** The AI writes raw Python scripts, guesses at variable states, and frequently makes methodological errors.
* **After Lemma:** The AI connects to a live Jupyter kernel, probes the data state in real-time, sets seeds, validates assumptions, and produces an ordered, re-runnable notebook artifact.

## Installation

```bash
npm install -g @tkpratardan/lemma
lemma
```

`lemma` auto-detects installed agents (Claude Code, Cursor, VS Code, Windsurf, etc.) and configures each in a single pass. 

**Configuration Options:**

```bash
lemma --dry-run                # Preview the configuration changes for each detected agent
lemma --only claude-code        # Configure a single specific agent
lemma --configure vscode        # Restrict a host to one notebook surface: vscode/vscode clones, pycharm, or jupyter
lemma --uninstall               # Remove Lemma configurations from all agents
lemma --help                    # List every option and its supported values
```

### Manual MCP Configuration

`npm install -g @tkpratardan/lemma` (above) also installs `lemma-mcp` on your PATH. If your client isn't one of the auto-configured hosts, skip running `lemma` and point the client's own config at the binary directly:

```json
{
  "mcpServers": {
    "lemma": { "command": "lemma-mcp" }
  }
}
```

## What Ships

One command puts her everywhere you work. Ten hosts in a single pass: Claude Code, Cursor, VS Code, Windsurf, Claude Desktop, Codex, GitHub Copilot CLI, Antigravity / Gemini CLI, opencode, and OpenClaw. Each one gets three things:

1.  **The Persona:** Her judgment rides into every host through whichever channel it honors natively (MCP instructions, session-start hook, context file, or steering file). Every session starts with a seasoned data scientist already in the room.
2.  **Stateful Interfaces:** She looks instead of guessing. MCP tools drive a live notebook across three surfaces (VS Code/Cursor via extension; PyCharm/DataSpell via disk and kernel, no plugin needed; JupyterLab via real-time collaboration), so the agent reads what is actually in the kernel, not what it remembers a cell printing.
3.  **Specialized Skills:** She matches the rigor to the question. "What happened", "is this difference real", and "did the change cause it" are three different questions, and she works each one differently: eight skills, one per kind of question an analysis can actually be, from the first look at a fresh dataset to the review of someone else's result.


### Strengthening the Persona on Instruction-Only Hosts

Some hosts have no global config path for an always-on ruleset, and MCP alone does not close that gap: not every client surfaces the server's instructions, and the `lemma_skill` tool is pull-based, so an agent that never received the persona does not know to call it. For a host-native guarantee, copy the matching rules file into your own project:

| Host | File |
| :--- | :--- |
| Cursor | [`.cursor/rules/lemma-datascience.mdc`](.cursor/rules/lemma-datascience.mdc) |
| Windsurf | [`.windsurf/rules/lemma.md`](.windsurf/rules/lemma.md) |
| GitHub Copilot | [`.github/copilot-instructions.md`](.github/copilot-instructions.md) |
| Any other | [`AGENTS.md`](AGENTS.md) |

Each file is the same persona, generated verbatim from `AGENTS.md` with only host-specific frontmatter. Copy it as-is; hand edits are overwritten the next time the copies are regenerated (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## Requirements

Ensure your environment meets the prerequisites for your chosen surface:

| Surface | Requirements |
| :--- | :--- |
| **`jupyterlab_*`** | An active `jupyter lab` instance with `jupyter-collaboration` installed |
| **`vscode_*`** | Lemma VS Code extension installed (automatic via `lemma` installer) |
| **`pycharm_*`** | A PyCharm/DataSpell-open notebook on disk and its active Jupyter kernel |

*For complete tool references, see [docs/tools.md](docs/tools.md).*
*For system architecture, see [docs/architecture.md](docs/architecture.md).*

## Contributing

We welcome contributions. Please review [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

BSD 4-Clause
