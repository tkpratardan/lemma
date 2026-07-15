#!/usr/bin/env python3
"""Runs Claude Code on 35 hard DSAEval tasks, graded by DSAEval's own judge.

Unlike run_dsaeval.py, this does NOT curate a narrow checkable answer per
task. Tasks are used exactly as DSAEval wrote them (raw question, full
reasoning + answer as ground truth), because most of them are open-ended
enough that reducing them to one exact-match scalar would either be
impossible or would throw away most of what makes them hard. Grading is
DSAEval's own evaluation.py rubric (ReasoningProcess/CodeSteps/FinalResults/
Consistency), imported and called UNMODIFIED -- the only thing swapped out
is the transport: evaluate_answer_multimodal() expects an OpenAI-style
client, so _ClaudeJudgeClient below duck-types just enough of that interface
to route the same call through subscription `claude -p` instead of an API
key. The rubric text itself is never touched.

Task selection (see evals/dsaeval_hard_tasks.json): the hardest (by
reasoning+question length, as a difficulty proxy) task from each of
DSAEval's top-20 task_type combos and top-20 domains, confidence>=3 (trust
the ground truth), dataset<10MB. 35 unique tasks after de-duplication. No
data_type restriction this time -- a few are image/text tasks -- so a
handful may be slow, may time out, or may need real model training; failures
are logged per-task and don't stop the batch.

We don't have DSAEval's Google-Drive ground-truth figure bundle, and our
agents don't emit DSAEval's own figure-path delimiter, so ref_images and
pred_images are always empty here. The rubric already tolerates this
gracefully (it only penalizes a missing figure when the question explicitly
asked for a plot) -- this is a transport limitation, not a rubric change.

Prerequisites: same as run_dsaeval.py (Kaggle token, jupyter-lab env for the
lemma arm) plus `pip install openai tqdm nbformat` -- needed only because
evaluation.py imports them at module level; none are actually called here.

Usage:
    python3 evals/run_dsaeval_hard.py [--arm baseline|lemma|both] [--limit N]
        [--tasks 92,570] [--model MODEL] [--max-turns N] [--judge-model M]

Results append to evals/runs/results.jsonl (benchmark: dsaeval-hard); read
them with report.py --benchmark dsaeval-hard, or see per-task scores.jsonl
for the full rubric breakdown (report.py's accuracy column can only show one
number, so we derive correct = FinalResults >= 5 and Consistency is True, the
rubric's own cutoff
for "correct, baseline quality").
"""

import argparse
import contextlib
import datetime
import json
import pathlib
import shutil
import subprocess
import sys
import time
from types import SimpleNamespace

import common

DATA_CACHE = pathlib.Path(__file__).resolve().parent / 'dsaeval-hard-data'
TASKS_FILE = pathlib.Path(__file__).resolve().parent / 'dsaeval_hard_tasks.json'
SCORES_FILE = common.RUNS / 'dsaeval_hard_scores.jsonl'
DSA_EVAL_REPO = pathlib.Path.home() / 'src' / 'dsa_eval'

sys.path.insert(0, str(DSA_EVAL_REPO))
from evaluation import (  # noqa: E402  (DSAEval's own evaluator, unmodified)
    evaluate_answer_multimodal,
    notebook_to_eval_inputs,
    clean_json_string,
)

# Files that carry ground-truth answers (or prior model answers/judge
# verdicts) reachable from the same machine the agent's Bash tool runs on.
# Found the hard way: a baseline agent that got confused about where its
# data was ran `find ~` / `grep -r ~/src`, located dsaeval_hard_tasks.json,
# and printed the matching task's answer/reasoning fields verbatim into its
# own "analysis" (tasks 2699, 2700). Bash has no sandboxing -- --add-dir and
# friends only govern Claude's own Read/Write tools, not what a spawned
# shell process can reach -- so the only reliable guard is making these
# files physically unreadable for the duration of the agent's run.
GROUND_TRUTH_FILES = [
    TASKS_FILE,
    DSA_EVAL_REPO / 'dsaeval.json',
    common.RUNS / 'results.jsonl',
    SCORES_FILE,
]


@contextlib.contextmanager
def _hidden_from_agent():
    saved_modes = {}
    for f in GROUND_TRUTH_FILES:
        if f.exists():
            saved_modes[f] = f.stat().st_mode
            f.chmod(0o000)
    try:
        yield
    finally:
        for f, mode in saved_modes.items():
            f.chmod(mode)


GENERIC_CLOSING = 'Give your complete analysis and final answer.'
DEFAULT_JUDGE_MODEL = 'haiku'


class _ClaudeJudgeClient:
    """Duck-types OpenAI's client.chat.completions.create() so DSAEval's
    unmodified evaluate_answer_multimodal() can call it, routed through
    subscription `claude -p` instead of an API key."""

    def __init__(self, model: str):
        self._model = model

    @property
    def chat(self):
        outer = self

        class _Chat:
            class completions:
                @staticmethod
                def create(model, messages, temperature=0.1):
                    system = messages[0]['content']
                    content = messages[1]['content']
                    text = '\n'.join(
                        b['text'] for b in content if b.get('type') == 'text'
                    )
                    out = subprocess.run(
                        ['claude', '-p', text, '--system-prompt', system,
                         '--model', outer._model, '--output-format', 'json',
                         '--strict-mcp-config', '--disable-slash-commands'],
                        capture_output=True, text=True, timeout=180,
                        check=True,
                    )
                    result = json.loads(out.stdout)
                    return SimpleNamespace(choices=[SimpleNamespace(
                        message=SimpleNamespace(content=result.get('result', '')))])
        return _Chat()


def _predicted_code_from_transcript(ws: pathlib.Path):
    """Baseline arm has no notebook -- pulls the Bash code it actually ran
    from the transcript, in the same shape notebook_to_eval_inputs()
    returns, so the (unmodified) judge prompt sees a comparable structure
    either way."""
    transcript = ws / 'claude.transcript.jsonl'
    if not transcript.exists():
        return None
    blocks = []
    for line in transcript.read_text().splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get('type') != 'assistant':
            continue
        for block in event.get('message', {}).get('content', []):
            if block.get('type') == 'tool_use' and block.get('name') == 'Bash':
                code = block.get('input', {}).get('command', '')
                if code:
                    blocks.append({'step': len(blocks) + 1, 'code': code,
                                   'execution_status': 'unknown'})
    if not blocks:
        return None
    return {'total_steps': len(blocks), 'implementation_details': blocks}


def _make_workspace(task: dict, arm: str, run_id: str) -> pathlib.Path:
    ws = common.RUNS / run_id / arm / str(task['id'])
    shutil.rmtree(ws, ignore_errors=True)
    ws.mkdir(parents=True)
    src = common.ensure_kaggle_dataset(task['dataset'], DATA_CACHE)
    for item in src.iterdir():
        dest = ws / item.name
        if item.is_dir():
            shutil.copytree(item, dest)
        else:
            shutil.copy(item, dest)
    if arm == 'lemma':
        common.install_lemma_kit(ws)
    return ws


def _build_prompt(task: dict) -> str:
    return f"{task['question']}\n\n{GENERIC_CLOSING}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arm', default='both',
                        choices=['baseline', 'lemma', 'both'])
    parser.add_argument('--limit', type=int, default=None)
    parser.add_argument('--tasks', default=None,
                        help='comma-separated task ids')
    parser.add_argument('--model', default='claude-sonnet-5')
    parser.add_argument('--judge-model', default=DEFAULT_JUDGE_MODEL)
    parser.add_argument('--max-turns', type=int, default=30)
    args = parser.parse_args()

    arms = ['baseline', 'lemma'] if args.arm == 'both' else [args.arm]
    run_id = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    tasks = json.loads(TASKS_FILE.read_text())
    if args.tasks:
        wanted = set(args.tasks.split(','))
        tasks = [t for t in tasks if str(t['id']) in wanted]
    if args.limit is not None:
        tasks = tasks[:args.limit]

    judge = _ClaudeJudgeClient(args.judge_model)

    for task in tasks:
        for arm in arms:
            row = {'runId': run_id, 'benchmark': 'dsaeval-hard', 'arm': arm,
                   'model': args.model, 'task': str(task['id']),
                   'category': task.get('domain'), 'truth': 'n/a (llm-judged)'}
            started = time.time()
            jupyter = None
            try:
                ws = _make_workspace(task, arm, run_id)
                prompt = _build_prompt(task)
                env = None
                if arm == 'lemma':
                    jupyter = common.start_jupyter(ws)
                    env = {'LEMMA_JUPYTER_URL': jupyter['url'],
                           'LEMMA_JUPYTER_TOKEN': jupyter['token'],
                           'LEMMA_JUPYTER_NOTEBOOK': jupyter['notebook']}
                with _hidden_from_agent():
                    res = common.run_claude(ws, prompt, arm, args.model,
                                            args.max_turns, env=env)
                predicted_reasoning_answer = res.get('result', '')

                notebook = ws / 'analysis.ipynb'
                predicted_code = None
                if arm == 'lemma' and notebook.exists():
                    predicted_code, _, _ = notebook_to_eval_inputs(str(notebook))
                if predicted_code is None:
                    predicted_code = _predicted_code_from_transcript(ws)

                standard_answer = (
                    f"Reasoning:\n{task.get('reasoning', '')}\n\n"
                    f"Answer:\n{task.get('answer', '')}"
                )
                eval_raw = evaluate_answer_multimodal(
                    problem=task['question'],
                    standard_answer=standard_answer,
                    predicted_code=predicted_code,
                    predicted_reasoning_answer=predicted_reasoning_answer,
                    ref_images=[],
                    pred_images=[],
                    client=judge,
                    model=args.judge_model,
                )
                scores = json.loads(clean_json_string(eval_raw))
                final_results = scores.get('FinalResults')
                row.update(
                    pred=(f"R={scores.get('ReasoningProcess')} "
                          f"C={scores.get('CodeSteps')} "
                          f"F={final_results} "
                          f"consistent={scores.get('Consistency')}"),
                    # The rubric's own "Fair - Baseline" cutoff (5-6) is
                    # defined as "correct and achieves the same level of
                    # quality as the standard answer" -- used here only to
                    # populate report.py's accuracy column; scores.jsonl has
                    # the full breakdown. Consistency gates it: the rubric
                    # defines Consistency=false as "the narrative claims
                    # results the code did not produce" -- i.e. a
                    # hallucination wearing a plausible-looking score. A
                    # FinalResults>=5 answer that isn't grounded in its own
                    # code isn't correct, whatever the number says.
                    correct=(isinstance(final_results, (int, float))
                            and final_results >= 5
                            and scores.get('Consistency') is True),
                    costUsd=res.get('total_cost_usd'),
                    numTurns=res.get('num_turns'),
                    durationMs=res.get('duration_ms'),
                    usage=res.get('usage'),
                    microEval=res.get('micro_eval'),
                    scores=scores,
                )
            except Exception as e:
                stderr = getattr(e, 'stderr', '') or ''
                row.update(error=f'{stderr}\n{e}'[:2000],
                           durationMs=int((time.time() - started) * 1000))
            finally:
                if jupyter is not None:
                    common.stop_jupyter(jupyter)
            common.append_result(row)
            common.print_status(row)
            SCORES_FILE.parent.mkdir(parents=True, exist_ok=True)
            with SCORES_FILE.open('a') as f:
                f.write(json.dumps(row) + '\n')


if __name__ == '__main__':
    main()
