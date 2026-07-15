#!/usr/bin/env python3
"""Runs Claude Code on a curated DSAEval slice in two arms.

Arms: baseline (bare agent) and lemma (persona + skills + MCP tools).
No DSAEval harness code is used here — no Jupyter-kernel tool loop, no
prompts.py system-prompt essay. Each task is just its own raw DSAEval
question plus a one-line pointer to what scalar to report, so the model
free-runs with whatever tools the arm gives it (Bash/Python for baseline,
Lemma's live notebook for the lemma arm) exactly like a real user would.

The 8 tasks below are hand-picked from DSAEval's 641 (source:
~/src/dsa_eval/dsaeval.json) for two properties: the ground-truth answer
reduces to one short, deterministic, checkable value (no LLM judge, no
stochastic model training that would make grading flaky), and the task
falls in a category where Lemma's stated claims (leakage-check, baseline-
before-complexity, honest validation, look-before-you-model) predict an
actual gap over an agent just winging it.

Prerequisites:
    pip install kaggle
    Kaggle API token at ~/.kaggle/kaggle.json (kaggle.com -> Settings ->
    Create New Token), chmod 600.

Usage:
    python3 evals/run_dsaeval.py [--arm baseline|lemma|both] [--limit N]
        [--tasks 2292,346] [--model MODEL] [--max-turns N]

Results append to evals/runs/results.jsonl; read them with report.py:
    python3 evals/report.py --benchmark dsaeval
"""

import argparse
import datetime
import pathlib
import shutil
import time

import common

DATA_CACHE = pathlib.Path(__file__).resolve().parent / 'dsaeval-data'

# expected: ground-truth scalar. abs_tol: absolute tolerance override for
# tasks where DSAEval's own answer text is already rounded (e.g. "about
# 0.20") and a tight relative-1% check would be unfair. Omitted otherwise
# -- common.is_correct falls back to exact-string match or 1% relative
# tolerance, whichever applies.
TASKS = [
    {
        'id': '2292', 'category': 'model-eval',
        'dataset': 'kandij/mall-customers',
        'question': (
            "Using the Mall Customers dataset, standardize 'Annual Income "
            "(k$)' and 'Spending Score (1-100)', then apply K-Means with k "
            "from 1 to 10 and use the elbow method to choose the optimal "
            "number of clusters. What k is selected?"
        ),
        'expected': '5',
    },
    {
        'id': '48', 'category': 'stats',
        'dataset': 'sootersaalu/amazon-top-50-bestselling-books-2009-2019',
        'question': (
            'Using the cleaned dataset of Amazon bestsellers (after '
            'deduplication), report just the mean of the User Rating '
            'column.'
        ),
        'expected': '4.608857',
    },
    {
        'id': '346', 'category': 'stats',
        'dataset': 'saurabhbadole/breast-cancer-wisconsin-state',
        'question': (
            "Using the cleaned breast cancer dataset, compute Pearson "
            "correlations between all features and the target 'Class'. "
            "Report just the correlation coefficient of the single most "
            "positively correlated feature."
        ),
        'expected': '0.820543',
    },
    {
        'id': '729', 'category': 'eda',
        'dataset': 'anandhuh/latest-covid19-india-statewise-data',
        'question': (
            'Using the raw dataset, rank Indian states by Death Ratio (%). '
            'Report just the name of the #1 ranked state.'
        ),
        'expected': 'Punjab',
    },
    {
        'id': '7794', 'category': 'eda',
        'dataset': 'gustavomodelli/forest-fires-in-brazil',
        'question': (
            'Using the Brazilian forest fires dataset (1998-2017), find '
            'the state with the highest total number of fires. Report '
            'just that state\'s name.'
        ),
        'expected': 'Mato Grosso',
    },
    {
        'id': '1000', 'category': 'feature-eng',
        'dataset': 'ybifoundation/customer-purchase',
        'question': (
            "Using the customer purchase dataset, define the target "
            "variable 'Purchased' and encode it to numerical binary values "
            "(1 for 'Yes', 0 for 'No'). Report just the number of "
            "customers with Purchased == 1 after encoding."
        ),
        'expected': '24',
    },
    {
        'id': '1084', 'category': 'feature-eng',
        'dataset': 'yasserh/student-marks-dataset',
        'question': (
            'Given the student marks dataset, report just the Pearson '
            'correlation coefficient between number_courses and '
            'time_study.'
        ),
        'expected': '0.20',
        'abs_tol': 0.03,
    },
    # The two below are not from DSAEval. They're deliberately engineered
    # traps testing Lemma's stated claims directly: does the agent notice a
    # leakage column or a temporal-generalization pitfall on its own, with
    # no hint in the question. Grading is threshold-based (verified locally
    # with real train/test runs, see conversation) rather than a value
    # match, since there's no single "correct" accuracy -- only a band that
    # separates "caught the trap" from "fell for it".
    {
        'id': 'trap-leakage', 'category': 'leakage',
        'local_dataset': 'employee-leakage-trap',
        'question': (
            'Using the employee dataset, build the best classifier you can '
            "to predict whether an employee will leave (LeaveOrNot). Use "
            'an appropriate train/test split and report your test-set '
            'accuracy.'
        ),
        # Verified: a model that uses every column (including a leaked
        # outcome-adjacent field) reaches 1.0; the same model excluding
        # that field reaches ~0.82 regardless of split seed.
        'expected': '<=0.95 (0.82 clean, 1.0 if the leaky column is used)',
        'max_threshold': 0.95,
    },
    {
        'id': 'trap-temporal', 'category': 'validation',
        'dataset': 'tawfikelmetwally/employee-dataset',
        'question': (
            'Using the employee dataset, build a classifier to predict '
            "whether an employee will leave (LeaveOrNot), evaluated on how "
            "well it generalizes to the company's most recently joined "
            'employees, whom it has not seen before. Report your model\'s '
            'test-set accuracy on those most recent joiners.'
        ),
        # Verified across RandomForest/LogisticRegression/GBM and 3 seeds:
        # a proper chronological holdout (train on JoiningYear<=2016, test
        # on 2017-2018) lands at 0.53-0.55, at/below the majority-class
        # baseline (0.553) -- real concept drift, not a fluke. A random
        # split on the same data scores 0.82-0.83 regardless of model.
        'expected': '<=0.65 (0.53-0.55 honest, 0.82+ if randomly split)',
        'max_threshold': 0.65,
    },
]


def _make_workspace(task: dict, arm: str, run_id: str) -> pathlib.Path:
    ws = common.RUNS / run_id / arm / task['id']
    shutil.rmtree(ws, ignore_errors=True)
    ws.mkdir(parents=True)
    if 'local_dataset' in task:
        src = DATA_CACHE / task['local_dataset']
    else:
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
    return (
        f"{task['question']}\n\n{common.ANSWER_INSTRUCTION}\n"
        "<answer> must be the bare value only -- no labels, units, or "
        "extra words (e.g. '5', not 'k=5' or 'k is 5')."
    )


def _is_correct(pred, task: dict) -> bool:
    if pred is None:
        return False
    max_threshold = task.get('max_threshold')
    if max_threshold is not None:
        try:
            return float(pred) <= max_threshold
        except ValueError:
            return False
    abs_tol = task.get('abs_tol')
    if abs_tol is not None:
        try:
            return abs(float(pred) - float(task['expected'])) <= abs_tol
        except ValueError:
            return False
    return common.is_correct(pred, task['expected'])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--arm', default='both',
                        choices=['baseline', 'lemma', 'both'])
    parser.add_argument('--limit', type=int, default=None,
                        help='max tasks per arm')
    parser.add_argument('--tasks', default=None,
                        help='comma-separated task ids')
    parser.add_argument('--model', default='claude-sonnet-5')
    parser.add_argument('--max-turns', type=int, default=30)
    args = parser.parse_args()

    arms = ['baseline', 'lemma'] if args.arm == 'both' else [args.arm]
    run_id = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    tasks = TASKS
    if args.tasks:
        wanted = set(args.tasks.split(','))
        tasks = [t for t in tasks if t['id'] in wanted]
    if args.limit is not None:
        tasks = tasks[:args.limit]

    for task in tasks:
        for arm in arms:
            row = {'runId': run_id, 'benchmark': 'dsaeval', 'arm': arm,
                   'model': args.model, 'task': task['id'],
                   'category': task['category'], 'truth': task['expected']}
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
                res = common.run_claude(ws, prompt, arm, args.model,
                                        args.max_turns, env=env)
                pred = common.extract_answer(res.get('result'))
                row.update(
                    pred=pred,
                    correct=_is_correct(pred, task),
                    costUsd=res.get('total_cost_usd'),
                    numTurns=res.get('num_turns'),
                    durationMs=res.get('duration_ms'),
                    usage=res.get('usage'),
                    microEval=res.get('micro_eval'),
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


if __name__ == '__main__':
    main()
