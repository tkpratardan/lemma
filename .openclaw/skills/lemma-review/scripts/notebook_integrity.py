"""Static notebook-integrity checks for use from a review notebook cell."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def check_notebook(path: str | Path) -> dict[str, Any]:
    """Report cached errors, unexecuted code, and execution-order anomalies."""
    notebook_path = Path(path).expanduser().resolve()
    with notebook_path.open("r", encoding="utf-8") as handle:
        notebook = json.load(handle)

    cells = notebook.get("cells", [])
    code_cells = [cell for cell in cells if cell.get("cell_type") == "code"]
    execution_counts = [
        cell.get("execution_count")
        for cell in code_cells
        if isinstance(cell.get("execution_count"), int)
    ]
    cached_errors = []
    for index, cell in enumerate(cells):
        for output in cell.get("outputs", []):
            if output.get("output_type") == "error":
                cached_errors.append(
                    {
                        "cell_index": index,
                        "ename": output.get("ename"),
                        "evalue": output.get("evalue"),
                    }
                )

    non_monotonic = any(
        current <= previous
        for previous, current in zip(execution_counts, execution_counts[1:])
    )
    duplicates = sorted(
        count for count in set(execution_counts) if execution_counts.count(count) > 1
    )
    return {
        "path": str(notebook_path),
        "cells": len(cells),
        "code_cells": len(code_cells),
        "unexecuted_code_cells": sum(
            cell.get("execution_count") is None for cell in code_cells
        ),
        "cached_errors": cached_errors,
        "duplicate_execution_counts": duplicates,
        "non_monotonic_execution_order": non_monotonic,
        "passes_static_integrity": not cached_errors and not duplicates and not non_monotonic,
    }


__all__ = ["check_notebook"]
