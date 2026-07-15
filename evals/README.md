# DSAEval benchmark: what runs, what doesn't, and why

Two runners compare baseline Claude Code against Claude Code with Lemma installed, on tasks from [DSAEval](https://github.com/AMA-CMFAI/DSAEval). Neither runner uses DSAEval's own harness. This file documents that choice and exactly what got left out of DSAEval's own prompts, and why.

## Files

| File | What it does |
|---|---|
| `run_dsaeval.py` | 9 hand-curated tasks plus 2 engineered traps (leakage, temporal validation). Exact/threshold grading, no LLM judge. |
| `run_dsaeval_hard.py` | The hardest task from each of DSAEval's 20 most common `task_type` labels and 20 most common `domain` labels, 34 tasks after dedup. Graded by DSAEval's own judge rubric. |
| `select_dsaeval_hard_tasks.py` | Rebuilds `dsaeval_hard_tasks.json` from DSAEval's own data. `--check` verifies the committed file matches exactly. |
| `common.py` | Shared harness: drives headless `claude -p`, provisions an isolated Jupyter server per lemma-arm task, downloads Kaggle datasets. |
| `report.py` | Summarizes `runs/results.jsonl` by benchmark and arm. |
| `runs/results.jsonl` | Every run's actual model answer, cost, tokens, turns. |
| `runs/dsaeval_hard_scores.jsonl` | The full judge verdict per task, including its written analysis. |

## Why not DSAEval's own harness

DSAEval ships its own reference agent (`data_agent.py`, a custom tool-calling loop) and its own system prompt (`prompts.py`, `DSAgent_PROMPT_LLM`). That combination produces DSAEval's published leaderboard numbers for various raw models. This benchmark answers a narrower question: does Claude Code behave differently with Lemma installed. Wrapping both arms in DSAEval's own agent scaffold would test "Claude Code inside DSAEval's persona," not Claude Code as a real user runs it. So neither arm uses DSAEval's tool loop, and neither gets DSAEval's system prompt. Each task is the raw DSAEval question plus one closing line: "Give your complete analysis and final answer."

The judge is different. DSAEval's `evaluation.py` grades free text against a reference answer; nothing about that rubric depends on DSAEval's own agent having produced the text. So the judge runs unmodified, imported directly, with only its transport swapped: `evaluate_answer_multimodal()` expects an OpenAI-style client, and `_ClaudeJudgeClient` in `run_dsaeval_hard.py` duck-types that interface to route the same call through subscription `claude -p` instead of an API key.

## What DSAEval's own prompt says, and what we do with each piece

Judge side: nothing missing. The system message is one line, `"You are an objective evaluator."`, passed through as `--system-prompt`. The full `EVAL_PROMPT` rubric arrives as the prompt, unmodified, with the real problem, ground truth, code, and answer substituted in.

Agent side is where the real differences live. DSAEval's `DSAgent_PROMPT_LLM` says a lot; here's what each piece became once we decided not to use it:

| What DSAEval's prompt says | Kept or cut | Why |
|---|---|---|
| "You are an autonomous data and code execution agent..." | Cut | Generic framing. Claude Code already knows it's an agent. |
| GPU warnings (4x A100, don't touch CUDA, use PyTorch not TensorFlow) | Cut | Describes DSAEval's own shared GPU cluster, which doesn't exist here. |
| "Maximum of 20 steps... session forcibly terminated" | Cut | We have our own turn budget (`--max-turns`), but the agent is never told it exists. |
| "The user's data files are located at: `{data_path}`" | Cut | The agent is never told where its data is. |
| "Save outputs to: `{working_path}`" | Cut | Same reasoning. |
| "You do not have vision ability, save figures via `plt.savefig()`" | Cut | Describes DSAEval's own text-only API loop, not how Claude Code actually works. |
| Mandated 4-section output format (Task Understanding / Approach Summary / Key Implementation / Results & Explanation) | Cut on purpose | DSAEval's own harness ties its output contract to its own judging. The judge rubric doesn't require this format either; it grades free text. |
| `%matplotlib inline` reminder, pip-install boilerplate, the `IMPORT_PMT` pre-import snippet | Cut | Environment setup for DSAEval's own IPython kernel loop. Not applicable to a Bash-tool agent. |

## Reproducing the task selection

`select_dsaeval_hard_tasks.py` takes DSAEval's 20 most common `task_type` labels and 20 most common `domain` labels, and keeps the single hardest task in each of those 40 buckets. Difficulty is a proxy, the combined length of the question and DSAEval's own reference reasoning, since DSAEval ships no actual difficulty score. Two guardrails: skip anything DSAEval's own confidence score rated below 3, and skip datasets over 10MB. Buckets overlap, so after dedup: 34 tasks.

```bash
python3 select_dsaeval_hard_tasks.py --check
```

reproduces the committed task list exactly, byte for byte, from DSAEval's own `dsaeval.json`.

## Running it

```bash
python3 run_dsaeval.py --arm both
python3 run_dsaeval_hard.py --arm both --max-turns 40
python3 report.py --benchmark dsaeval-hard
```

Needs a Kaggle API token (`~/.kaggle/access_token` or `~/.kaggle/kaggle.json`) and, for the lemma arm, a local `jupyter-lab` with `jupyter-collaboration` installed. No `ANTHROPIC_API_KEY` anywhere; every agent call and every judge call runs on subscription auth.
