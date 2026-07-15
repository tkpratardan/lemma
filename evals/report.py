#!/usr/bin/env python3
"""Summarizes evals/runs/results.jsonl: accuracy vs token cost per arm.

Usage:
    python3 evals/report.py [--run RUN_ID]
"""

import argparse
import json
import pathlib
import statistics

_RESULTS = pathlib.Path(__file__).resolve().parent / 'runs' / 'results.jsonl'


def _tokens(row: dict) -> int:
    u = row.get('usage') or {}
    return sum(u.get(k, 0) for k in
               ('input_tokens', 'output_tokens',
                'cache_creation_input_tokens', 'cache_read_input_tokens'))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', default=None, help='filter to one run id')
    parser.add_argument('--benchmark', default=None,
                        help='filter to one benchmark')
    args = parser.parse_args()

    rows = [json.loads(line) for line in _RESULTS.read_text().splitlines()]
    if args.run:
        rows = [r for r in rows if r['runId'] == args.run]
    if args.benchmark:
        rows = [r for r in rows if r['benchmark'] == args.benchmark]
    if not rows:
        print('No results.')
        return

    groups = sorted({(r['benchmark'], r['arm']) for r in rows})
    header = (f'{"benchmark":<18} {"arm":<10} {"n":>4} {"err":>4} '
              f'{"acc%":>6} {"cw%":>6} {"tok/q":>10} {"$/q":>7} '
              f'{"s/q":>6} {"calls":>6} {"respKB":>7} {"shell":>6} '
              f'{"dup":>5} {"audit%":>6} {"micro%":>7} {"acc/Mtok":>9}')
    print(header)
    print('-' * len(header))
    for bench, arm in groups:
        sub = [r for r in rows
               if r['arm'] == arm and r['benchmark'] == bench]
        ok = [r for r in sub if 'error' not in r]
        errors = len(sub) - len(ok)
        if not ok:
            print(f'{bench:<18} {arm:<10} {len(sub):>4} {errors:>4}'
                  '   all errored')
            continue
        acc = sum(r['correct'] for r in ok) / len(ok)
        # Confident-wrong: gave a definite answer and it was wrong — the
        # "supreme bullshitter" rate. Distinct from abstaining (pred None).
        cw = sum(1 for r in ok
                 if not r['correct'] and r.get('pred') is not None) / len(ok)
        tok = statistics.mean(_tokens(r) for r in ok)
        cost = statistics.mean(r.get('costUsd') or 0 for r in ok)
        secs = statistics.mean((r.get('durationMs') or 0) / 1000
                               for r in ok)
        micros = [r.get('microEval') or {} for r in ok]
        calls = statistics.mean(m.get('tool_call_count', 0) for m in micros)
        response_kb = statistics.mean(
            m.get('tool_response_bytes', 0) for m in micros) / 1024
        shell = statistics.mean(m.get('shell_escape_count', 0) for m in micros)
        duplicates = statistics.mean(
            m.get('duplicate_computation_count', 0) for m in micros)
        audit = [m.get('audit_receipt_recorded') for m in micros
                 if m.get('audit_receipt_recorded') is not None]
        audit_display = (f'{statistics.mean(audit) * 100:>6.1f}'
                         if audit else f'{"-":>6}')
        micro_pass = [m.get('passed') for m in micros if 'passed' in m]
        micro_display = (f'{statistics.mean(micro_pass) * 100:>7.1f}'
                         if micro_pass else f'{"-":>7}')
        # Headline for the .tasks.md question: correctness bought per
        # million tokens spent.
        per_mtok = acc / tok * 1e6 if tok else 0
        print(f'{bench:<18} {arm:<10} {len(sub):>4} {errors:>4} '
              f'{acc * 100:>6.1f} {cw * 100:>6.1f} {tok:>10.0f} '
              f'{cost:>7.3f} {secs:>6.0f} {calls:>6.1f} '
              f'{response_kb:>7.1f} {shell:>6.1f} {duplicates:>5.1f} '
              f'{audit_display} {micro_display} {per_mtok:>9.2f}')


if __name__ == '__main__':
    main()
