# Tool reference

## Any host

| Tool | What it does |
|---|---|
| `lemma_skill(name)` | Return one lemma skill ruleset (full SKILL.md) — the pull path for hosts without native skill support |

## JupyterLab (`jupyterlab_connect`) and PyCharm (`pycharm_connect`, `pycharm_status`)

`jupyter-collaboration` must be installed on the server for JupyterLab. A pasted `?token=` URL is accepted for `server_url`. If `server_url` is omitted (and `LEMMA_JUPYTER_URL` isn't set), `jupyterlab_connect` tries to auto-discover a local server, see [Requirements](../README.md#requirements) for when that applies and when it doesn't.

| Tool | What it does |
|---|---|
| `jupyterlab_connect(server_url?, token?, notebook_path?)` | Connect to a running JupyterLab server, or auto-discover one locally |
| `pycharm_connect(server_url, notebook_file[, notebook_path])` | Attach the kernel + target the on-disk notebook |
| `pycharm_status()` | Check that the kernel + file are connected |

Every other jupyterlab/pycharm verb — read, edit, run, delete, etc. — is a shared `notebook_*` tool; see below.

## VS Code / Cursor (`vscode_*`)

Requires the [Lemma VS Code extension](../extensions/vscode/README.md). Every tool below except `vscode_status` also takes `path` (the `.ipynb`, absolute or workspace-relative), omitted from the table for brevity.

| Tool | What it does |
|---|---|
| `vscode_status()` | Check that the extension bridge is reachable |
| `vscode_execute_cell(code)` | Add and run a cell |
| `vscode_add_and_run(source, index?)` | Insert + run in one call (preferred over insert then run) |
| `vscode_probe(code)` | Run code and return output without adding a cell (environment checks) |
| `vscode_insert_cell(index, source)` | Insert a cell at a position |
| `vscode_edit_cell(index, source)` | Edit a cell in place |
| `vscode_edit_and_run(index, source)` | Edit a cell in place and run it |
| `vscode_run_cell(index)` | Run an existing cell |
| `vscode_run_all_cells()` | Run every code cell top to bottom, stopping at the first error |
| `vscode_read_cell_output(index, offset?)` | A cell's stored output at full fidelity: paged text plus plot images, without re-running |
| `vscode_add_markdown(text)` | Append a markdown cell |
| `vscode_delete_cell(index)` | Delete a cell |
| `vscode_clear_notebook()` | Delete all cells (irreversible) |
| `vscode_read_notebook()` | Full notebook (sources and outputs) |
| `vscode_get_state()` | Kernel variables and cell outline |
| `vscode_inspect_variable(name)` | Variable detail |
| `vscode_save_notebook()` | Save the open notebook |
| `vscode_restart_kernel()` | Restart the kernel |

## PyCharm / DataSpell (`pycharm_*`)

No IDE plugin. PyCharm has no public notebook API, but it reloads an open `.ipynb` when the file changes on disk. These tools drive the notebook over its Jupyter kernel plus read-modify-write of the `.ipynb` file.

| Tool | What it does |
|---|---|
| `pycharm_connect(server_url, notebook_file[, notebook_path])` | Attach the kernel + target the on-disk notebook |
| `pycharm_status()` | Check that the kernel + file are connected |
| `pycharm_execute_cell(code)` | Append a code cell and run it (alias of `notebook_add_and_run`) |
| `pycharm_probe(code)` | Run code and return output without adding a cell (environment checks) |
| `pycharm_insert_cell(index, source)` | Insert a cell at a position without running it |

## Notebook — shared pycharm/jupyterlab verbs (`notebook_*`)

Every verb pycharm and jupyterlab implement the same way, registered once with a `surface` argument (`pycharm` or `jupyterlab`) instead of twice under separate prefixes.

| Tool | What it does |
|---|---|
| `notebook_read(surface)` | Full notebook (sources and outputs) |
| `notebook_get_state(surface)` | Cell outline (plus kernel variables, on jupyterlab) |
| `notebook_add_and_run(surface, source, index?)` | Add a cell and run it (`index` is pycharm-only; jupyterlab always appends) |
| `notebook_run_cell(surface, index)` | Run an existing cell |
| `notebook_run_all_cells(surface)` | Run every code cell top to bottom, stopping at the first error |
| `notebook_read_cell_output(surface, index, offset?)` | A cell's stored output at full fidelity: paged text plus plot images, without re-running |
| `notebook_edit_cell(surface, index, source)` | Edit a cell in place |
| `notebook_edit_and_run(surface, index, source)` | Edit a cell in place and run it |
| `notebook_delete_cell(surface, index)` | Delete a cell |
| `notebook_add_markdown(surface, text)` | Append a markdown cell |
| `notebook_inspect_variable(surface, name)` | Variable detail |
| `notebook_clear_notebook(surface)` | Delete all cells (irreversible) |
| `notebook_restart_kernel(surface)` | Restart the kernel |
| `notebook_save_notebook(surface)` | Save to disk (no-op on pycharm; it writes on every edit) |

`lemma --configure vscode\|pycharm\|jupyter` (see [install](../README.md)) restricts a host to one surface. With only one surface configured, `surface`'s enum collapses to that single value rather than disappearing from the schema.

## JupyterLab auth

Token only (`Authorization: token ...`).

- **No auth**: no token needed.
- **Token required**: pass it explicitly, or paste a `?token=` URL.
- **JupyterHub**: generate a Hub API token from Control Panel and pass it with your user-server URL.
- **Password / cookie auth**: not supported. Generate a token instead.
