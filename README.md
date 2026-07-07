<p align="center">
  <img src="https://raw.githubusercontent.com/tkpratardan/lemma/master/assets/lemma_icon.png" width="220" alt="Lemma">
</p>

<h1 align="center">Lemma</h1>

<p align="center">
  <em>Savvy, stateful, and reproducible.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tkpratardan/lemma"><img src="https://img.shields.io/npm/v/@tkpratardan/lemma?style=flat-square&color=111111&label=npm" alt="npm"></a>
  <a href="https://github.com/tkpratardan/lemma/releases"><img src="https://img.shields.io/github/v/release/tkpratardan/lemma?style=flat-square&color=111111&label=release" alt="Release"></a>
  <img src="https://img.shields.io/badge/license-MIT-111111?style=flat-square" alt="MIT license">
</p>



<p align="center">
  <img src="https://raw.githubusercontent.com/tkpratardan/lemma/master/assets/lemma-in-action.gif" width="800" alt="Lemma in action">
</p>


---


You know her. Hand her a notebook and she looks before she types: what the data says, why it matters, what to try next. Her notebooks read like a story: clear, reproducible, the same every time you run them.

Build her into your agent.

* **After Lemma:** You agent works with notebook hosted in a live Jupyter kernel, probes the data state in real-time, sets seeds, validates assumptions, and produces an ordered, re-runnable notebook artifact.

**Where Lemma Fits?**

Lemma is host-agnostic: any client that speaks MCP can run her. She fits right into the data science and modeling workflow you already have, editor, terminal, or a notebook hosted in a managed environment (see [Requirements](#requirements) for caveats), showing up as your agent's MCP server and working the same way in each one. Agents that also support hooks and skills get her full persona and skill set built in, not just the tools.

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

One command brings her everywhere you work. Ten hosts in a single pass: Claude Code, Cursor, VS Code, Windsurf, Claude Desktop, Codex, GitHub Copilot CLI, Antigravity / Gemini CLI, opencode, and OpenClaw. Each one gets three things:

1.  **The Persona:** Her judgment rides into every host through whichever channel it honors natively (MCP instructions, session-start hook, context file, or steering file). Every session starts with a seasoned data scientist already in the room.
2.  **Stateful Interfaces:** She looks instead of guessing. MCP tools drive a live notebook across three surfaces (VS Code/Cursor via extension; PyCharm/DataSpell via disk and kernel, no plugin needed; JupyterLab via real-time collaboration), so the agent reads what is actually in the kernel, not what it remembers a cell printing.
3.  **Specialized Skills:** She matches the rigor to the question. "What happened", "is this difference real", and "did the change cause it" are three different questions, and she works each one differently: nine skills, one per kind of question an analysis can actually be, from the first look at a fresh dataset to the review of someone else's result.


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

> **Note:** `jupyterlab_*` and `pycharm_*` are both still naive. `pycharm_*` needs a connection URL and writes to disk instead of live-editing, since PyCharm has no live-edit API; it relies on PyCharm's own reload-on-change. `jupyterlab_*` needs a server URL and token too, Lemma can't discover them on its own, with one hack, not a guarantee: as a subprocess of Jupyter AI's own chat (which spawns agents alongside [`jupyter-server-mcp`](https://github.com/jupyter-ai-contrib/jupyter-server-mcp), its own in-process MCP server), Lemma scans the local Jupyter runtime directory for a running server instead of asking, since that subprocess is guaranteed to be colocated with it. It isn't foolproof: more than one local notebook, or none found, falls back to asking the user or to Jupyter AI's own tools.

*For complete tool references, see [docs/tools.md](docs/tools.md).*
*For system architecture, see [docs/architecture.md](docs/architecture.md).*


## Contributing

We welcome contributions. Please review [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
