#!/usr/bin/env python3
"""Compute bounded agent-behavior metrics from Claude stream-json events."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys
from collections import Counter, defaultdict
from typing import Any, Iterable

_INLINE_INTERPRETER = re.compile(
    r"(?:python(?:3)?\s+(?:-c|-)|rscript\s+-e|node\s+-e)", re.I
)
_SHELL_DATA_COMMAND = re.compile(
    r"\b(?:awk|jq|sqlite3|csvcut|csvgrep|csvstat)\b", re.I
)
_DATA_PATH = re.compile(
    r"(?:^|[\s'\"])([\w./~@+-]+\.(?:csv|tsv|xlsx?|xlsm|parquet|pq|jsonl?|ndjson|feather|arrow))\b",
    re.I,
)


def _content_blocks(event: dict[str, Any]) -> list[dict[str, Any]]:
    message = event.get("message") if isinstance(event.get("message"), dict) else event
    content = message.get("content") if isinstance(message, dict) else None
    return [block for block in content or [] if isinstance(block, dict)]


def _canonical_name(name: str) -> str:
    return name.rsplit("__", 1)[-1]


def _encoded_bytes(value: Any) -> int:
    if isinstance(value, str):
        return len(value.encode("utf-8"))
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def _text_bytes(value: Any) -> int:
    if isinstance(value, str):
        return len(value.encode("utf-8"))
    if isinstance(value, list):
        return sum(
            _encoded_bytes(item.get("text", ""))
            for item in value
            if isinstance(item, dict) and item.get("type") == "text"
        )
    if isinstance(value, dict):
        if value.get("type") == "text":
            return _encoded_bytes(value.get("text", ""))
        return sum(_text_bytes(item) for item in value.values())
    return 0


def _tool_calls(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    for event in events:
        for block in _content_blocks(event):
            if block.get("type") == "tool_use":
                calls.append({
                    "id": str(block.get("id", "")),
                    "name": str(block.get("name", "")),
                    "input": block.get("input") if isinstance(block.get("input"), dict) else {},
                })
    return calls


def _tool_results(events: Iterable[dict[str, Any]], names: dict[str, str]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for event in events:
        for block in _content_blocks(event):
            if block.get("type") != "tool_result":
                continue
            identifier = str(block.get("tool_use_id", ""))
            content = block.get("content", "")
            results.append({
                "id": identifier,
                "name": names.get(identifier, "unknown"),
                "bytes": _encoded_bytes(content),
                "text_bytes": _text_bytes(content),
                "content": content,
            })
    return results


def _payload(call: dict[str, Any]) -> str | None:
    inputs = call["input"]
    canonical = _canonical_name(call["name"])
    if canonical in {"run", "edit", "notebook_add_and_run", "notebook_edit_and_run"}:
        value = inputs.get("source") or inputs.get("code")
    elif canonical == "inspect" and (inputs.get("source") or inputs.get("target") == "source"):
        value = json.dumps(inputs.get("source") or inputs, sort_keys=True, separators=(",", ":"))
    elif canonical.lower() in {"bash", "shell", "exec_command"} or "bash" in canonical.lower():
        value = inputs.get("command") or inputs.get("cmd")
    else:
        return None
    if not isinstance(value, str) or not value.strip():
        return None
    return re.sub(r"\s+", " ", value).strip()


def _source_paths(payload: str) -> set[str]:
    return {match.group(1).lower() for match in _DATA_PATH.finditer(payload)}


def _is_shell_escape(call: dict[str, Any]) -> bool:
    canonical = _canonical_name(call["name"]).lower()
    if canonical not in {"bash", "shell", "exec_command"} and "bash" not in canonical:
        return False
    command = call["input"].get("command") or call["input"].get("cmd") or ""
    return bool(
        isinstance(command, str)
        and (_INLINE_INTERPRETER.search(command) or _SHELL_DATA_COMMAND.search(command))
    )


def _result_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        )
    return json.dumps(content, ensure_ascii=False)


def analyze_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    calls = _tool_calls(events)
    names = {call["id"]: call["name"] for call in calls}
    results = _tool_results(events, names)
    lemma_calls = [call for call in calls if "lemma" in call["name"].lower()]

    payloads = [(call, _payload(call)) for call in calls]
    payloads = [(call, payload) for call, payload in payloads if payload]
    fingerprints = Counter(
        hashlib.sha256(payload.encode("utf-8")).hexdigest()
        for _, payload in payloads
    )
    exact_duplicates = sum(count - 1 for count in fingerprints.values() if count > 1)
    source_families: dict[str, set[str]] = defaultdict(set)
    for call, payload in payloads:
        canonical = _canonical_name(call["name"]).lower()
        family = "shell" if canonical in {"bash", "shell", "exec_command"} or "bash" in canonical else "notebook"
        for source in _source_paths(payload):
            source_families[source].add(family)
    cross_surface_duplicates = sum(1 for families in source_families.values() if len(families) > 1)

    publish_calls = [call for call in lemma_calls if _canonical_name(call["name"]) == "publish_answer"]
    structured_publish = any(
        isinstance(call["input"].get("result"), dict)
        and isinstance(call["input"].get("evidence"), list)
        and len(call["input"]["evidence"]) > 0
        for call in publish_calls
    )
    receipt_recorded = any(
        _canonical_name(result["name"]) == "publish_answer"
        and re.search(r'"status":"(?:recorded|finalized)"', re.sub(r"\s+", "", _result_text(result["content"])))
        for result in results
    )
    audit_receipt = structured_publish and receipt_recorded if publish_calls else None

    response_sizes = [result["bytes"] for result in results]
    text_sizes = [result["text_bytes"] for result in results]
    lifecycle_text_sizes = [
        result["text_bytes"]
        for result in results
        if _canonical_name(result["name"]) in {"checkpoint", "publish_answer"}
    ]
    shell_escapes = sum(1 for call in calls if _is_shell_escape(call))
    duplicate_count = exact_duplicates + cross_surface_duplicates
    checks = {
        "response_text_budget": max(text_sizes, default=0) <= 8192
        and max(lifecycle_text_sizes, default=0) <= 2048,
        "no_shell_escape": shell_escapes == 0,
        "no_duplicate_computation": duplicate_count == 0,
        # Audit receipts are optional. If requested, they still need to be valid.
        "audit_receipt_recorded": audit_receipt,
    }
    applicable_checks = [value for value in checks.values() if value is not None]
    return {
        "tool_call_count": len(calls),
        "lemma_tool_call_count": len(lemma_calls),
        "tool_response_bytes": sum(response_sizes),
        "tool_response_text_bytes": sum(text_sizes),
        "max_tool_response_bytes": max(response_sizes, default=0),
        "max_tool_response_text_bytes": max(text_sizes, default=0),
        "oversized_text_response_count": sum(size > 8192 for size in text_sizes),
        "oversized_lifecycle_response_count": sum(size > 2048 for size in lifecycle_text_sizes),
        "shell_escape_count": shell_escapes,
        "exact_duplicate_computations": exact_duplicates,
        "cross_surface_source_recomputations": cross_surface_duplicates,
        "duplicate_computation_count": duplicate_count,
        "audit_receipt_recorded": audit_receipt,
        "checks": checks,
        "passed": all(applicable_checks),
    }


def parse_stream(stdout: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    events = [json.loads(line) for line in stdout.splitlines() if line.strip()]
    results = [event for event in events if event.get("type") == "result"]
    if not results:
        raise json.JSONDecodeError(
            "Claude stream-json output contained no result event", stdout, 0
        )
    result = dict(results[-1])
    result["micro_eval"] = analyze_events(events)
    return result, events


def _load(path: str) -> list[dict[str, Any]]:
    text = sys.stdin.read() if path == "-" else pathlib.Path(path).read_text()
    stripped = text.strip()
    if stripped.startswith("["):
        return json.loads(stripped)
    return [json.loads(line) for line in stripped.splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("transcript", help="Claude stream-json transcript, or - for stdin")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    print(json.dumps(analyze_events(_load(args.transcript)), indent=2 if args.pretty else None))


if __name__ == "__main__":
    main()
