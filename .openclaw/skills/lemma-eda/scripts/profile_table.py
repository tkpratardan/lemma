"""Deterministic first-pass profiling for a pandas DataFrame.

Example:
    from profile_table import profile_frame
    profile_frame(df)
"""

from __future__ import annotations

from typing import Any

import pandas as pd


def _top_values(series: pd.Series, top_n: int) -> list[dict[str, Any]]:
    counts = series.value_counts(dropna=False).head(top_n)
    total = max(len(series), 1)
    return [
        {
            "value": repr(value),
            "count": int(count),
            "rate": float(count / total),
        }
        for value, count in counts.items()
    ]


def profile_frame(frame: pd.DataFrame, *, top_n: int = 5) -> pd.DataFrame:
    """Profile types, missingness, uniqueness, ranges, and common values."""
    if top_n < 1:
        raise ValueError("top_n must be at least 1")

    rows: list[dict[str, Any]] = []
    denominator = max(len(frame), 1)
    for column in frame.columns:
        series = frame[column]
        non_missing = series.dropna()
        numeric = pd.api.types.is_numeric_dtype(series)
        rows.append(
            {
                "column": str(column),
                "dtype": str(series.dtype),
                "rows": int(len(series)),
                "missing": int(series.isna().sum()),
                "missing_rate": float(series.isna().sum() / denominator),
                "unique_non_null": int(non_missing.nunique(dropna=True)),
                "min": non_missing.min() if len(non_missing) and numeric else None,
                "median": non_missing.median() if len(non_missing) and numeric else None,
                "max": non_missing.max() if len(non_missing) and numeric else None,
                "top_values": _top_values(series, top_n),
            }
        )
    return pd.DataFrame(rows)


__all__ = ["profile_frame"]
