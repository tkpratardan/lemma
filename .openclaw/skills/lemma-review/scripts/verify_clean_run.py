"""Execute a notebook in a fresh kernel without overwriting the source file.

Use the canonical ``verify_clean_run`` MCP action during interactive work. This
helper is the deterministic CI/off-surface equivalent.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

def verify_clean_run(
    notebook_path: str | Path,
    *,
    output_path: str | Path | None = None,
    timeout_seconds: int = 600,
) -> dict[str, Any]:
    """Run all code cells in a fresh kernel and return a compact pass/fail record."""
    try:
        import nbformat
        from nbclient import NotebookClient
        from nbclient.exceptions import CellExecutionError
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "clean-run verification requires the Jupyter packages nbformat and nbclient"
        ) from error

    source = Path(notebook_path).expanduser().resolve()
    destination = Path(output_path).expanduser().resolve() if output_path else None
    if destination == source:
        raise ValueError("output_path must not overwrite the source notebook")

    with source.open("r", encoding="utf-8") as handle:
        notebook = nbformat.read(handle, as_version=4)
    code_cells = sum(cell.cell_type == "code" for cell in notebook.cells)
    client = NotebookClient(
        notebook,
        timeout=timeout_seconds,
        allow_errors=False,
        record_timing=False,
        resources={"metadata": {"path": str(source.parent)}},
    )
    try:
        executed = client.execute()
    except CellExecutionError as error:
        return {
            "passed": False,
            "notebook": str(source),
            "code_cells": code_cells,
            "error": str(error)[-4000:],
        }

    if destination is not None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("w", encoding="utf-8") as handle:
            nbformat.write(executed, handle)
    return {
        "passed": True,
        "notebook": str(source),
        "code_cells": code_cells,
        "executed_artifact": str(destination) if destination else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("notebook")
    parser.add_argument("--output", help="Optional path for the executed copy; never the source path.")
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()
    result = verify_clean_run(args.notebook, output_path=args.output, timeout_seconds=args.timeout)
    print(json.dumps(result, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = ["verify_clean_run"]
