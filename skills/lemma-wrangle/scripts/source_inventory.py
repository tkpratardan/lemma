"""Deterministic source inventory for use from a notebook cell.

Example:
    from source_inventory import inventory_sources
    inventory_sources(["data/orders.csv", "data/customers.parquet"])
"""

from __future__ import annotations

import csv
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


def _sha256(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def _csv_shape(path: Path) -> tuple[int | None, list[str] | None]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle, delimiter="\t" if path.suffix.lower() == ".tsv" else ",")
            columns = next(reader, None)
            rows = sum(1 for _ in reader)
        return rows, columns
    except (UnicodeDecodeError, csv.Error, OSError):
        return None, None


def inventory_sources(
    paths: Iterable[str | Path], *, hash_contents: bool = True
) -> list[dict[str, object]]:
    """Return a stable, compact source registry sorted by resolved path."""
    files: list[Path] = []
    for raw_path in paths:
        path = Path(raw_path).expanduser()
        if path.is_dir():
            files.extend(candidate for candidate in path.rglob("*") if candidate.is_file())
        else:
            files.append(path)

    registry: list[dict[str, object]] = []
    for path in sorted(files, key=lambda item: str(item.resolve())):
        resolved = path.resolve()
        if not resolved.exists():
            registry.append({"path": str(resolved), "exists": False})
            continue

        stat = resolved.stat()
        record: dict[str, object] = {
            "path": str(resolved),
            "exists": True,
            "format": resolved.suffix.lower().lstrip(".") or "unknown",
            "bytes": stat.st_size,
            "modified_utc": datetime.fromtimestamp(
                stat.st_mtime, tz=timezone.utc
            ).isoformat(),
        }
        if hash_contents:
            record["sha256"] = _sha256(resolved)
        if resolved.suffix.lower() in {".csv", ".tsv"}:
            rows, columns = _csv_shape(resolved)
            record["data_rows"] = rows
            record["columns"] = columns
        registry.append(record)
    return registry


__all__ = ["inventory_sources"]
