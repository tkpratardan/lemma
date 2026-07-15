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
3.  **Specialized Skills:** She matches the rigor to the question. "What happened", "is this difference real", and "did the change cause it" are three different questions, and she works each one differently: ten skills, one per kind of question an analysis can actually be, from assembling a working dataset out of messy sources to the review of someone else's result.


### Strengthening the Persona on Instruction-Only Hosts

Some hosts have no global config path for an always-on ruleset, and MCP alone does not close that gap: not every client surfaces the server's instructions, and the `lemma_skill` prompt is pull-based, so an agent that never received the persona does not know to request it. For a host-native guarantee, copy the matching rules file into your own project:

| Host | File |
| :--- | :--- |
| Cursor | [`.cursor/rules/lemma-datascience.mdc`](.cursor/rules/lemma-datascience.mdc) |
| Windsurf | [`.windsurf/rules/lemma.md`](.windsurf/rules/lemma.md) |
| GitHub Copilot | [`.github/copilot-instructions.md`](.github/copilot-instructions.md) |
| Any other | [`AGENTS.md`](AGENTS.md) |

Each file is the same persona, generated verbatim from `AGENTS.md` with only host-specific frontmatter. Copy it as-is; hand edits are overwritten the next time the copies are regenerated (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## Numbers

Headless Claude Code (Sonnet 5, subscription auth, no API key) on [DSAEval](https://github.com/AMA-CMFAI/DSAEval), baseline (no skill) vs Lemma, none of DSAEval's own harness used — real questions, real Kaggle datasets, judged by DSAEval's own unmodified rubric (Haiku).

<p align="center">
  <img src="assets/benchmark-dsaeval.svg" width="860" alt="Baseline vs Lemma on 34 hard DSAEval tasks: accuracy 44.1% baseline vs 84.8% lemma, confident-wrong rate 55.9% baseline vs 15.2% lemma, cost per task $0.50 baseline vs $0.62 lemma (1.23x)">
</p>

| | easy set (9 tasks) | hard set (34 tasks) |
| :--- | ---: | ---: |
| baseline / lemma accuracy | 100% / 100% | 44.1% / **84.8%** |
| baseline / lemma confident-wrong | 0% / 0% | 55.9% / **15.2%** |
| baseline / lemma $/task | $0.155 / $0.576 | $0.504 / $0.621 |

On the hardest task from every DSAEval task type and domain, baseline gives a confidently wrong answer more than half the time; Lemma about 1 in 7, at 1.23x the cost. On clean single-answer questions with no room for rigor to pay off, both tie at 100% and Lemma's overhead is pure cost.

No curated writeup — the raw artifacts are the source of truth:

* [`evals/run_dsaeval.py`](evals/run_dsaeval.py) / [`evals/run_dsaeval_hard.py`](evals/run_dsaeval_hard.py) — the eval scripts, questions and ground truth inline (`run_dsaeval.py`) or in [`evals/dsaeval_hard_tasks.json`](evals/dsaeval_hard_tasks.json) (question, DSAEval's reasoning + answer, dataset, category)
* [`evals/runs/results.jsonl`](evals/runs/results.jsonl) — every run's actual model answer (`pred`), cost, tokens, turns (filter `benchmark: dsaeval` / `dsaeval-hard`)
* [`evals/runs/dsaeval_hard_scores.jsonl`](evals/runs/dsaeval_hard_scores.jsonl) — the full judge verdict per task: `ReasoningProcess`/`CodeSteps`/`FinalResults`/`Consistency` scores plus its written `Analysis`

```bash
cd evals
python3 run_dsaeval.py --arm both && python3 run_dsaeval_hard.py --arm both --max-turns 40
python3 report.py --benchmark dsaeval-hard
```

## Requirements

Ensure your environment meets the prerequisites for your chosen surface:

| Surface | Requirements |
| :--- | :--- |
| **JupyterLab** | An active `jupyter lab` instance with `jupyter-collaboration` installed |
| **VS Code / Cursor** | Lemma VS Code extension installed (automatic via `lemma` installer) |
| **PyCharm / DataSpell** | An open notebook on disk and its active Jupyter kernel |

> **Note:** The agent always sees the same five analysis actions. Normal actions attach lazily to the preferred surface. `connect(surface=...)` can switch among VS Code, PyCharm, and JupyterLab during the same session without resetting the selected kernel; `reset_kernel=true` makes a restart explicit. Internally, PyCharm needs a connection URL and writes through the on-disk notebook because it has no live-edit API. JupyterLab accepts a URL and token or attempts local auto-discovery; multiple or missing local notebooks are reported instead of guessed.

*For complete tool references, see [docs/tools.md](docs/tools.md).*
*For system architecture, see [docs/architecture.md](docs/architecture.md).*


## Contributing

We welcome contributions. Please review [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
