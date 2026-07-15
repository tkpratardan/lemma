#!/usr/bin/env python3
"""Score every Claude transcript beneath a benchmark result directory."""

from __future__ import annotations

import argparse
import json
import pathlib

from micro_eval import analyze_events


def load_events(path: pathlib.Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text().splitlines()
        if line.strip()
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("result_root", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()

    root = args.result_root.resolve()
    rows = []
    for transcript in sorted(root.rglob("claude.transcript.jsonl")):
        rows.append({
            "transcript": str(transcript),
            "relative_path": str(transcript.relative_to(root)),
            "microEval": analyze_events(load_events(transcript)),
        })
    output = args.output or root / "lemma_micro_evals.jsonl"
    output.write_text("".join(json.dumps(row) + "\n" for row in rows))
    print(f"scored {len(rows)} transcript(s): {output}")


if __name__ == "__main__":
    main()
