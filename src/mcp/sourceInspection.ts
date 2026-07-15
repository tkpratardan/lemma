export type SourceHeaderRow = 'auto' | 'none' | number;

export type SourceInspectionSingleRequest =
  | { view: 'inventory'; paths: string[]; hashContents: boolean; maxFiles: number }
  | {
      view: 'schema';
      path: string;
      sheet?: string | number;
      headerRow: SourceHeaderRow;
      maxColumns: number;
    }
  | {
      view: 'head';
      path: string;
      sheet?: string | number;
      headerRow: SourceHeaderRow;
      rows: number;
      maxColumns: number;
    }
  | {
      view: 'profile';
      path: string;
      sheet?: string | number;
      headerRow: SourceHeaderRow;
      topN: number;
      maxColumns: number;
    };

export type SourceInspectionRequest =
  | SourceInspectionSingleRequest
  | { view: 'batch'; requests: SourceInspectionSingleRequest[] };

// The first source observation in a task installs this durable helper. Later
// observations add only a compact invocation cell, so the notebook remains
// rerunnable without repeating hundreds of lines for every source.
export function sourceInspectionHelperCode(): string {
  return `# Lemma source inspection helper v4
def _lemma_inspect_source(config):
    from pathlib import Path
    import csv
    import glob
    import hashlib
    import json
    import re

    def clean(value):
        if value is None:
            return None
        try:
            if _lemma_pd.isna(value):
                return None
        except (TypeError, ValueError):
            pass
        if hasattr(value, "item"):
            try:
                value = value.item()
            except (ValueError, TypeError):
                pass
        if hasattr(value, "isoformat"):
            try:
                return value.isoformat()
            except (ValueError, TypeError):
                pass
        if isinstance(value, (str, int, float, bool)):
            return value if not isinstance(value, str) else value[:300]
        return repr(value)[:300]

    def header_candidates(raw, max_columns):
        ranked = []
        for row_index, row in raw.iloc[:25, :max_columns].iterrows():
            values = [value for value in row.tolist() if not _lemma_pd.isna(value) and str(value).strip()]
            if not values:
                continue
            labels = [str(value).strip() for value in values]
            text_count = sum(isinstance(value, str) and bool(re.search(r"[A-Za-z]", value)) for value in values)
            unique_count = len(set(labels))
            score = text_count * 4 + unique_count + len(values) / 10
            ranked.append({
                "row_index": int(row_index),
                "score": round(float(score), 3),
                "non_null": len(values),
                "text_values": text_count,
                "values": [clean(value) for value in values[:15]],
            })
        ranked.sort(key=lambda item: (-item["score"], item["row_index"]))
        return ranked[:5]

    def raw_preview(raw):
        return [
            {"row_index": int(index), "values": [clean(value) for value in row.tolist()[:15]]}
            for index, row in raw.iloc[:8, :15].iterrows()
        ]

    def read_delimited(path, separator, header, nrows=None):
        last_error = None
        for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin1"):
            try:
                frame = _lemma_pd.read_csv(
                    path, sep=separator, header=header, nrows=nrows, encoding=encoding
                )
                return frame, encoding
            except UnicodeDecodeError as error:
                last_error = error
        raise last_error or UnicodeDecodeError("utf-8", b"", 0, 1, "unable to decode source")

    def inventory(item):
        candidates = []
        for raw in item["paths"]:
            expanded = str(Path(raw).expanduser())
            if any(char in expanded for char in "*?["):
                candidates.extend(Path(found) for found in glob.glob(expanded, recursive=True))
                continue
            path = Path(expanded)
            if path.is_dir():
                candidates.extend(found for found in path.rglob("*") if found.is_file())
            else:
                candidates.append(path)
        ordered = sorted({str(path.resolve()): path.resolve() for path in candidates}.values(), key=str)
        records = []
        for path in ordered[:item["maxFiles"]]:
            if not path.exists():
                records.append({"path": str(path), "exists": False})
                continue
            stat = path.stat()
            suffix = path.suffix.lower()
            record = {
                "path": str(path),
                "exists": True,
                "format": suffix.lstrip(".") or "unknown",
                "bytes": stat.st_size,
            }
            if item["hashContents"]:
                digest = hashlib.sha256()
                with path.open("rb") as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        digest.update(chunk)
                record["sha256"] = digest.hexdigest()
            if suffix in {".csv", ".tsv"}:
                try:
                    with path.open("r", encoding="utf-8-sig", newline="") as handle:
                        reader = csv.reader(handle, delimiter="\t" if suffix == ".tsv" else ",")
                        record["columns"] = next(reader, [])[:100]
                        record["data_rows"] = sum(1 for _ in reader)
                except (UnicodeDecodeError, csv.Error, OSError):
                    record["columns"] = None
                    record["data_rows"] = None
            elif suffix in {".xlsx", ".xls", ".xlsm"}:
                try:
                    record["sheets"] = [str(name) for name in _lemma_pd.ExcelFile(path).sheet_names]
                except (ValueError, OSError, ImportError):
                    record["sheets"] = None
            records.append(record)
        return {
            "view": "inventory",
            "sources": records,
            "source_count": len(ordered),
            "returned": len(records),
            "truncated": len(ordered) > item["maxFiles"],
        }

    def table(item):
        path = Path(item["path"]).expanduser().resolve()
        suffix = path.suffix.lower()
        workbook = None
        selected_sheet = item.get("sheet", 0)
        candidates = []
        preview = []
        header_row = None
        encoding = None
        setting = item.get("headerRow", "auto")
        if suffix in {".xlsx", ".xls", ".xlsm"}:
            workbook = _lemma_pd.ExcelFile(path)
            raw = _lemma_pd.read_excel(path, sheet_name=selected_sheet, header=None, nrows=25)
            candidates = header_candidates(raw, item["maxColumns"])
            preview = raw_preview(raw)
            if setting == "auto":
                header_row = candidates[0]["row_index"] if candidates else 0
            elif setting == "none":
                header_row = None
            else:
                header_row = int(setting)
            frame = _lemma_pd.read_excel(path, sheet_name=selected_sheet, header=header_row)
        elif suffix in {".csv", ".tsv"}:
            separator = "\t" if suffix == ".tsv" else ","
            raw, encoding = read_delimited(path, separator, header=None, nrows=25)
            candidates = header_candidates(raw, item["maxColumns"])
            preview = raw_preview(raw)
            if setting == "auto":
                header_row = candidates[0]["row_index"] if candidates else 0
            elif setting == "none":
                header_row = None
            else:
                header_row = int(setting)
            frame, encoding = read_delimited(path, separator, header=header_row)
        elif suffix in {".parquet", ".pq"}:
            frame = _lemma_pd.read_parquet(path)
        elif suffix in {".jsonl", ".ndjson"}:
            frame = _lemma_pd.read_json(path, lines=True)
        elif suffix == ".json":
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
            if isinstance(payload, dict) and all(
                not isinstance(value, (dict, list)) for value in payload.values()
            ):
                frame = _lemma_pd.DataFrame(list(payload.items()), columns=["key", "value"])
            elif isinstance(payload, dict):
                try:
                    frame = _lemma_pd.DataFrame(payload)
                except ValueError:
                    frame = _lemma_pd.json_normalize(payload)
            elif isinstance(payload, list):
                frame = _lemma_pd.json_normalize(payload)
            else:
                frame = _lemma_pd.DataFrame({"value": [payload]})
        elif suffix in {".feather", ".arrow"}:
            frame = _lemma_pd.read_feather(path)
        else:
            raise ValueError(f"unsupported source format: {suffix or 'no extension'}")
        if not isinstance(frame, _lemma_pd.DataFrame):
            raise TypeError("source did not resolve to one table; specify a sheet")

        selected = list(frame.columns[:item["maxColumns"]])
        base = {
            "view": item["view"],
            "path": str(path),
            "rows": int(len(frame)),
            "columns": int(len(frame.columns)),
            "returned_columns": len(selected),
            "truncated_columns": len(frame.columns) > item["maxColumns"],
            "header_row": header_row,
            "encoding": encoding,
        }
        if workbook is not None:
            base["sheets"] = [str(name) for name in workbook.sheet_names]
            base["selected_sheet"] = selected_sheet
        if candidates:
            base["header_candidates"] = candidates
        if item["view"] == "schema":
            base["raw_preview"] = preview
            base["schema"] = [
                {
                    "column": str(column),
                    "dtype": str(frame[column].dtype),
                    "missing": int(frame[column].isna().sum()),
                    "non_null": int(frame[column].notna().sum()),
                }
                for column in selected
            ]
            return base
        if item["view"] == "head":
            records = frame.loc[:, selected].head(item["rows"]).to_dict(orient="records")
            base["records"] = [
                {str(key): clean(value) for key, value in record.items()}
                for record in records
            ]
            return base

        profile = []
        denominator = max(len(frame), 1)
        for column in selected:
            series = frame[column]
            non_missing = series.dropna()
            try:
                unique = int(non_missing.nunique(dropna=True))
            except TypeError:
                unique = None
            counts = series.value_counts(dropna=False).head(item["topN"])
            summary = {
                "column": str(column),
                "dtype": str(series.dtype),
                "missing": int(series.isna().sum()),
                "missing_rate": float(series.isna().sum() / denominator),
                "unique_non_null": unique,
                "top_values": [
                    {"value": clean(value), "count": int(count), "rate": float(count / denominator)}
                    for value, count in counts.items()
                ],
            }
            if len(non_missing) and _lemma_pd.api.types.is_numeric_dtype(series):
                summary.update({
                    "min": clean(non_missing.min()),
                    "median": clean(non_missing.median()),
                    "max": clean(non_missing.max()),
                })
            profile.append(summary)
        base["profile"] = profile
        return base

    def observe(item):
        try:
            return inventory(item) if item["view"] == "inventory" else table(item)
        except Exception as error:
            return {
                "view": item.get("view"),
                "path": item.get("path"),
                "paths": item.get("paths"),
                "error": f"{type(error).__name__}: {str(error)[:500]}",
            }

    import pandas as _lemma_pd
    if config["view"] == "batch":
        return {
            "view": "batch",
            "observations": [observe(item) for item in config["requests"]],
        }
    return observe(config)

def _lemma_compact_source_observation(observation, max_chars=3000):
    import json

    def clean_value(value, depth=0):
        if isinstance(value, str):
            return value[:120]
        if value is None or isinstance(value, (int, float, bool)):
            return value
        if depth >= 3:
            return repr(value)[:120]
        if isinstance(value, list):
            return [clean_value(item, depth + 1) for item in value[:12]]
        if isinstance(value, dict):
            return {
                str(key): clean_value(item, depth + 1)
                for key, item in list(value.items())[:12]
            }
        return repr(value)[:120]

    def base(item):
        keys = (
            "view", "path", "paths", "error", "rows", "columns",
            "returned_columns", "truncated_columns", "header_row", "encoding",
            "sheets", "selected_sheet", "source_count", "returned", "truncated",
        )
        return {key: clean_value(item[key]) for key in keys if item.get(key) is not None}

    def compact_item(item, include_header=True):
        if not isinstance(item, dict):
            return clean_value(item)
        result = base(item)
        if item.get("view") == "inventory":
            result["sources"] = clean_value(item.get("sources", [])[:12])
            return result
        if include_header and item.get("header_candidates"):
            result["header_candidates"] = clean_value(item["header_candidates"][:2])
        if item.get("view") == "schema":
            result["raw_preview"] = clean_value(item.get("raw_preview", [])[:4])
            result["schema"] = clean_value(item.get("schema", [])[:20])
        elif item.get("view") == "head":
            result["records"] = clean_value(item.get("records", [])[:3])
        elif item.get("profile") is not None:
            result["profile"] = clean_value(item.get("profile", [])[:10])
        return result

    if isinstance(observation, dict) and observation.get("view") == "batch":
        raw_items = observation.get("observations", [])
        schema_paths = {
            item.get("path") for item in raw_items
            if isinstance(item, dict) and item.get("view") == "schema"
        }
        compacted = []
        for item in raw_items:
            duplicate_head = (
                isinstance(item, dict)
                and item.get("view") == "head"
                and item.get("path") in schema_paths
            )
            simple_schema = (
                isinstance(item, dict)
                and item.get("view") == "schema"
                and item.get("header_row") == 0
            )
            summary = compact_item(item, include_header=not duplicate_head and not simple_schema)
            if duplicate_head and isinstance(summary.get("records"), list):
                summary["records"] = summary["records"][:1]
            if simple_schema:
                summary.pop("raw_preview", None)
            compacted.append(summary)
        payload = {"view": "batch", "observations": compacted}
    else:
        payload = compact_item(observation)

    def encoded_size():
        return len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))

    # Preserve one entry per requested source while shrinking optional detail
    # until the executed cell output fits in every notebook adapter.
    items = payload.get("observations", [payload]) if isinstance(payload, dict) else []
    detail_keys = ("sources", "profile", "records", "schema", "header_candidates", "raw_preview")
    minimum_items = {
        "sources": 2,
        "profile": 3,
        "records": 1,
        "schema": 8,
        "header_candidates": 2,
        "raw_preview": 4,
    }
    while encoded_size() > max_chars:
        changed = False
        for key in detail_keys:
            for item in reversed(items):
                if not isinstance(item, dict):
                    continue
                values = item.get(key)
                minimum = minimum_items[key]
                if isinstance(values, list) and len(values) > minimum:
                    item[key] = values[:max(minimum, len(values) // 2)]
                    item["detail_truncated"] = True
                    changed = True
                    break
            if changed:
                break
        if not changed:
            break
    if encoded_size() > max_chars:
        for item in items:
            if not isinstance(item, dict):
                continue
            for key in detail_keys:
                item.pop(key, None)
            item["detail_truncated"] = True
    return payload`;
}

export function sourceInspectionCode(
  request: SourceInspectionRequest,
  options: { includeHelper?: boolean } = {}
): string {
  const encoded = JSON.stringify(JSON.stringify(request));
  const invocation = `# Lemma deterministic source ${request.view}
import json as _lemma_json
if "_lemma_inspect_source" not in globals():
    raise RuntimeError("Lemma source helper is missing; rerun the first source-inspection cell")
_lemma_source_observation = _lemma_inspect_source(_lemma_json.loads(${encoded}))
_lemma_source_summary = _lemma_compact_source_observation(_lemma_source_observation)
print(_lemma_json.dumps(_lemma_source_summary, ensure_ascii=False, separators=(",", ":")))
del _lemma_json`;
  return options.includeHelper === false
    ? invocation
    : `${sourceInspectionHelperCode()}\n\n${invocation}`;
}
