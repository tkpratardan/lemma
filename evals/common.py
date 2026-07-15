"""Shared harness pieces for the lemma benchmark runners.

Drives headless Claude Code in two arms (baseline vs lemma) and grades
FINAL ANSWER lines. Stdlib only, so it runs under any python3.
"""

import json
import os
import pathlib
import secrets
import shutil
import subprocess
import time

from micro_eval import parse_stream

REPO = pathlib.Path(__file__).resolve().parent.parent
# The lemma under test: the development repo, so eval arms pick up skill
# and persona changes without a copy step.
LEMMA = pathlib.Path.home() / 'src' / 'extended_lemma'
RUNS = REPO / 'evals' / 'runs'
RESULTS = RUNS / 'results.jsonl'

# Reused, not installed fresh: this venv already has jupyterlab +
# jupyter-collaboration. Needed for the lemma arm's live-notebook surface --
# without a per-task server, Lemma's connect tool falls back to local
# auto-discovery and will attach to *any* jupyter server already running on
# the machine (including someone else's, or a stale leftover), silently
# reusing its notebook state across unrelated tasks.
JUPYTER_BIN = pathlib.Path.home() / 'src' / 'kramabench' / '.venv' / 'bin' / 'jupyter-lab'
JUPYTER_RUNTIME_DIR = pathlib.Path.home() / 'Library' / 'Jupyter' / 'runtime'


def start_jupyter(ws: pathlib.Path) -> dict:
    """Starts a jupyter-lab server rooted at ws, isolated to one task."""
    if not JUPYTER_BIN.exists():
        raise SystemExit(
            f'{JUPYTER_BIN} not found. The lemma arm needs a jupyter-lab '
            'install with jupyter-collaboration on this machine.'
        )
    token = secrets.token_hex(16)
    notebook = ws / 'analysis.ipynb'
    notebook.write_text(json.dumps({
        'cells': [],
        'metadata': {'kernelspec': {'display_name': 'Python 3',
                                    'language': 'python', 'name': 'python3'}},
        'nbformat': 4,
        'nbformat_minor': 5,
    }))
    proc = subprocess.Popen(
        [str(JUPYTER_BIN), '--no-browser', '--ServerApp.ip=127.0.0.1',
         '--ServerApp.port=0', f'--ServerApp.token={token}',
         '--ServerApp.password=', f'--ServerApp.root_dir={ws}'],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    runtime_file = JUPYTER_RUNTIME_DIR / f'jpserver-{proc.pid}.json'
    deadline = time.time() + 30
    while time.time() < deadline:
        if runtime_file.exists():
            info = json.loads(runtime_file.read_text())
            return {'proc': proc, 'url': info['url'], 'token': token,
                    'notebook': str(notebook), 'runtime_file': runtime_file}
        if proc.poll() is not None:
            raise RuntimeError(
                f'jupyter-lab exited before starting (code {proc.returncode})'
            )
        time.sleep(0.5)
    proc.kill()
    raise TimeoutError('jupyter-lab did not start within 30s')


def ensure_kaggle_dataset(slug: str, cache_dir: pathlib.Path) -> pathlib.Path:
    """Downloads a Kaggle dataset into cache_dir, once."""
    target = cache_dir / slug.split('/')[-1]
    if target.exists() and any(target.iterdir()):
        return target
    try:
        from kaggle.api.kaggle_api_extended import KaggleApi
    except ModuleNotFoundError:
        raise SystemExit(
            "kaggle package not installed. Run: pip install kaggle, then "
            "put an API token at ~/.kaggle/kaggle.json "
            "(kaggle.com -> Settings -> Create New Token)."
        )
    target.mkdir(parents=True, exist_ok=True)
    api = KaggleApi()
    try:
        api.authenticate()
    except Exception as e:
        raise SystemExit(
            f"Kaggle auth failed ({e}). Put an API token at "
            "~/.kaggle/kaggle.json (kaggle.com -> Settings -> Create New "
            "Token), chmod 600."
        )
    api.dataset_download_files(slug, path=str(target), unzip=True, quiet=True)
    return target


def stop_jupyter(handle: dict) -> None:
    proc = handle['proc']
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    handle['runtime_file'].unlink(missing_ok=True)
    html = handle['runtime_file'].with_name(
        handle['runtime_file'].stem + '-open.html')
    html.unlink(missing_ok=True)

ANSWER_INSTRUCTION = (
    'Analyze the data and answer. Your last line MUST be exactly:\n'
    'FINAL ANSWER: <answer>'
)


def install_lemma_kit(ws: pathlib.Path) -> None:
    """Drops the lemma persona, skills, and MCP config into a workspace."""
    shutil.copy(LEMMA / 'AGENTS.md', ws / 'CLAUDE.md')
    shutil.copytree(LEMMA / 'skills', ws / '.claude' / 'skills')
    mcp = {'mcpServers': {'lemma': {
        'command': 'node',
        'args': [str(LEMMA / 'bin' / 'lemma-mcp.mjs')],
    }}}
    (ws / '.mcp.json').write_text(json.dumps(mcp))


def run_claude(ws: pathlib.Path, prompt: str, arm: str, model: str,
               max_turns: int, *, extra_args: list[str] | None = None,
               env: dict | None = None, session_id: str | None = None) -> dict:
    cmd = [
        'claude', '-p', prompt,
        '--output-format', 'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
        # Project-only settings: keeps the operator's own ~/.claude plugins
        # (including an installed lemma) out of both arms.
        '--setting-sources', 'project',
        '--model', model,
        '--max-turns', str(max_turns),
    ]
    if session_id:
        cmd += ['--resume', session_id]
    if arm == 'lemma':
        cmd += ['--mcp-config', str(ws / '.mcp.json')]
        # Without this, connect() may pick the vscode/pycharm surface if the
        # operator happens to have an editor open on the same machine, and
        # hang forever waiting on a notebook that was never opened for this
        # headless workspace. A dedicated jupyter-lab server is always
        # started per lemma-arm task (see start_jupyter), so it's always
        # the right (and only sane) choice here.
        cmd += ['--append-system-prompt',
                'When you need to connect to a notebook, use '
                'surface: jupyter. A dedicated Jupyter server has already '
                'been started for this task; do not use the vscode or '
                'pycharm surfaces.']
    if extra_args:
        cmd += extra_args
    out = subprocess.run(cmd, cwd=ws, capture_output=True, text=True,
                         timeout=30 * 60,
                         env={**os.environ, **(env or {})})
    # Written before the returncode check so a failed run still leaves a
    # transcript to diagnose -- check=True would otherwise raise before this
    # line ever ran, discarding the one thing needed to tell "hit max-turns"
    # apart from "crashed" apart from "hung".
    (ws / 'claude.transcript.jsonl').write_text(out.stdout)
    if out.returncode != 0:
        raise subprocess.CalledProcessError(out.returncode, cmd,
                                            output=out.stdout,
                                            stderr=out.stderr)
    result, _ = parse_stream(out.stdout)
    return result


def extract_answer(text: str) -> str:
    answers = [line.split(':', 1)[1].strip()
               for line in str(text).splitlines()
               if line.upper().startswith('FINAL ANSWER:')]
    return answers[-1] if answers else None


def _normalize(value) -> str:
    return ''.join(c for c in str(value).upper() if c not in '$,% \t')


def is_correct(pred, truth) -> bool:
    if pred is None:
        return False
    p, t = _normalize(pred), _normalize(truth)
    if p == t:
        return True
    try:
        pn, tn = float(p), float(t)
    except ValueError:
        return False
    # ponytail: 1% relative tolerance instead of a judge model; swap in
    # each benchmark's official scorer for publication-grade numbers.
    return abs(pn - tn) <= abs(tn) * 0.01


def append_result(row: dict) -> None:
    RUNS.mkdir(parents=True, exist_ok=True)
    with RESULTS.open('a') as f:
        f.write(json.dumps(row) + '\n')


def print_status(row: dict) -> None:
    label = f'{row["arm"]} {row["benchmark"]} {row.get("task")}'
    if row.get('question'):
        label += f'/{row["question"]}'
    if 'error' in row:
        print(f'{label}: ERROR {row["error"][:80]}', flush=True)
    else:
        print(f'{label}: {"PASS" if row["correct"] else "FAIL"} '
              f'pred={row["pred"]} truth={row["truth"]} '
              f'${row["costUsd"]:.3f}', flush=True)
