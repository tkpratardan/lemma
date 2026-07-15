#!/usr/bin/env python3
"""Rebuilds evals/dsaeval_hard_tasks.json from DSAEval's own dsaeval.json.

Not a random sample. Take DSAEval's N most common task_type labels and N
most common domain labels (default N=20 each), and keep the single hardest
task in each of those buckets. "Hardest" is a proxy: the combined length of
the question and DSAEval's own reference reasoning (its worked solution),
standing in for how many steps and constraints a task has. Two guardrails on
top: skip anything DSAEval's own confidence score rated below MIN_CONFIDENCE,
and skip datasets over MAX_SIZE_MB. Task and domain buckets overlap, so the
result is deduplicated by task id.

The reference reasoning collected here is ground truth for the judge only --
see run_dsaeval_hard.py, which never puts it in the agent's prompt.

Usage:
    python3 evals/select_dsaeval_hard_tasks.py                # rebuild
    python3 evals/select_dsaeval_hard_tasks.py --check         # verify only

Requires ~/src/dsa_eval/dsaeval.json (DSAEval's own task file, not shipped
in this repo -- clone https://github.com/AMA-CMFAI/DSAEval separately).
"""

import argparse
import collections
import json
import pathlib

DEFAULT_DSAEVAL_JSON = pathlib.Path.home() / 'src' / 'dsa_eval' / 'dsaeval.json'
OUTPUT = pathlib.Path(__file__).resolve().parent / 'dsaeval_hard_tasks.json'

# Dropped after review, not by the selection rule above -- kept explicit and
# named rather than silently absent. Each entry is (task id, reason).
EXCLUDED = {
    '4073': ("asks the agent to retrieve Kaggle's internal Google Cloud "
             "Storage mirror paths for a dataset -- a poor fit for a local "
             "sandbox regardless of arm, not a real data-science task"),
}


def select(dsaeval_json: pathlib.Path, top_n: int, min_confidence: float,
          max_size_mb: float) -> list[dict]:
    tasks = json.loads(dsaeval_json.read_text())

    type_freq = collections.Counter(t['task_type'] for t in tasks)
    domain_freq = collections.Counter(t['domain'] for t in tasks)
    top_types = [k for k, _ in type_freq.most_common(top_n)]
    top_domains = [k for k, _ in domain_freq.most_common(top_n)]

    pool = [t for t in tasks
            if t.get('confidence', 0) >= min_confidence
            and t['dataset_size_mb'] < max_size_mb]

    def difficulty(t: dict) -> int:
        return len(t['question']) + len(t['reasoning'])

    def hardest_in(field: str, value: str) -> dict | None:
        candidates = [t for t in pool if t[field] == value]
        return max(candidates, key=difficulty) if candidates else None

    selected: dict[str, dict] = {}
    for value in top_types:
        task = hardest_in('task_type', value)
        if task is None:
            continue
        entry = selected.setdefault(task['id'], {**task, 'selected_for': []})
        entry['selected_for'].append(f'task_type:{value}')
    for value in top_domains:
        task = hardest_in('domain', value)
        if task is None:
            continue
        entry = selected.setdefault(task['id'], {**task, 'selected_for': []})
        entry['selected_for'].append(f'domain:{value}')

    result = [t for t in selected.values() if str(t['id']) not in EXCLUDED]
    result.sort(key=lambda t: int(t['id']))
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dsaeval-json', type=pathlib.Path,
                        default=DEFAULT_DSAEVAL_JSON)
    parser.add_argument('--top-n', type=int, default=20,
                        help='top N task_type labels and top N domain labels')
    parser.add_argument('--min-confidence', type=float, default=3.0)
    parser.add_argument('--max-size-mb', type=float, default=10.0)
    parser.add_argument('--check', action='store_true',
                        help="verify the committed file matches; don't write")
    args = parser.parse_args()

    if not args.dsaeval_json.exists():
        raise SystemExit(
            f'{args.dsaeval_json} not found. Clone '
            'https://github.com/AMA-CMFAI/DSAEval and point --dsaeval-json '
            'at its dsaeval.json.'
        )

    result = select(args.dsaeval_json, args.top_n, args.min_confidence,
                    args.max_size_mb)

    print(f'{len(result)} tasks selected '
         f'({len(EXCLUDED)} excluded after review: '
         f'{", ".join(EXCLUDED)})')

    if args.check:
        current = json.loads(OUTPUT.read_text())
        if current == result:
            print(f'matches {OUTPUT}')
        else:
            current_ids = {str(t['id']) for t in current}
            result_ids = {str(t['id']) for t in result}
            if current_ids != result_ids:
                print(f'MISMATCH: committed has {len(current_ids)} ids, '
                     f'rebuilt has {len(result_ids)}')
                print(f'  only in committed: {sorted(current_ids - result_ids)}')
                print(f'  only in rebuilt:   {sorted(result_ids - current_ids)}')
            else:
                print('MISMATCH: same task ids, different field content '
                     '(dsaeval.json may have changed upstream)')
            raise SystemExit(1)
        return

    OUTPUT.write_text(json.dumps(result, indent=2) + '\n')
    print(f'wrote {OUTPUT}')


if __name__ == '__main__':
    main()
