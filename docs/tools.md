# Tool reference

Lemma exposes one notebook action interface on every surface. The server dispatches these actions to VS Code/Cursor, PyCharm/DataSpell, or JupyterLab internally.

| Action | Purpose |
|---|---|
| `connect` | Select or switch the notebook surface; optionally reset its kernel |
| `read` | Read compact state, the notebook, or a full stored cell output |
| `run` | Append and execute a durable cell, rerun one cell, or run all cells |
| `edit` | Replace, insert, delete, or add Markdown, optionally executing a code edit |
| `inspect` | Inspect a variable or one/batched source inventory/schema/head/profile request |

The default server exposes exactly these five analysis actions. Set
`LEMMA_AUDIT_TOOLS=1` to additionally expose `checkpoint`,
`verify_clean_run`, and `publish_answer` for workflows that explicitly need an
evidence ledger UI, a clean-run action, or an audit receipt. Set
`LEMMA_LEGACY_TOOLS=1` only while migrating a client that still calls
adapter-prefixed tools.

## Runtime contract

Start with the analysis action the work needs. `read`, `run`, `edit`, and
`inspect` lazily attach to the preferred surface and open a project-scoped
evidence ledger without resetting the kernel. If the surface or notebook is
ambiguous, the action returns a bounded recovery message; use `connect` once
with explicit details. `connect(surface="jupyter|pycharm|vscode")` can switch
surfaces at any time and preserves the turn's evidence. It preserves kernel
state by default; set `reset_kernel=true` only when a restart is intended. Its
optional `begin` metadata starts a separately labeled audit task.

Use notebook actions in whatever order the analysis requires. The server
automatically records notebook identity, inspections, executed cell ids and
hashes, bounded output summaries, errors, sources, and recognizable artifacts.
Optional audit metadata can add facts, assumptions, and risks. The server does
not impose stages, action limits, or a required publication call.

The passive ledger never serializes conversation history or arbitrary kernel
variables. With audit tools enabled, `checkpoint(record={...})` can preserve
validated facts with evidence, assumptions, artifact references, open risks, a
compact source registry, and explicitly resolved error IDs;
`checkpoint(status={...})` pages through that ledger.

Every successful `run` or executing `edit` returns a compact delta containing the cell and task revision, status, changed variables, output summary, errors, warnings, and a `read(kind="output")` pointer to the full result. Use `return_output="images"` to attach the first visualization (or select one with `image_index`) in that same execution call; `return_output="full"` explicitly includes stored text and images. The default remains the context-safe summary.

Stored output reads are text-only by default and report whether images are available. Use `read(kind="output", content="images", image_index=0)` to view one image, `content="metadata"` to inventory images without attaching them, or `content="all"` only when the complete stored output is needed.

`inspect(source={...})` supports `inventory`, `schema`, `head`, and `profile`; `source.view="batch"` executes up to eight compatible requests atomically so every file is represented in one balanced response. `inspect(variable={...})` handles existing kernel variables. Spreadsheet requests accept `sheet` and `header_row` (`"auto"`, `"none"`, or a zero-based row); automatic schema inspection returns sheet names, the selected sheet, candidate header rows, and a raw preview. The first source inspection installs one deterministic helper in a durable cell; later cells contain only compact calls to that helper. Inventory is capped and hashing is opt-in; table observations cap rows and columns.

With audit tools enabled, `verify_clean_run(confirm=true)` performs a clean
top-to-bottom rerun and `publish_answer` stores a result
hash/shape/evidence receipt after validating cited cells. Neither is the
user-facing answer or a completion requirement. Unresolved execution errors
remain mechanically blocking because they make evidence unreliable. On hosts
with a Stop hook, a missing evidence/chat outcome gets one concise reminder; it
is not a workflow controller.

## Surface connection arguments

- `--surface` or `LEMMA_SURFACE` sets the lazy-attachment preference; neither restricts later switching.
- VS Code/Cursor: requires the Lemma extension. Pass `notebook_path` when more than one notebook is open.
- PyCharm/DataSpell: pass `server_url` and the absolute on-disk `notebook_file`; `notebook_path` may pin the server-side kernel session. Lazy attachment can use `LEMMA_PYCHARM_URL`, `LEMMA_PYCHARM_NOTEBOOK_FILE`, `LEMMA_PYCHARM_NOTEBOOK`, and `LEMMA_PYCHARM_TOKEN`.
- JupyterLab: pass `server_url`, `token`, and optional `notebook_path`. Omitting `server_url` attempts local auto-discovery; ambiguity is returned instead of guessed.

JupyterLab token authentication and unauthenticated local servers are supported. Password/cookie authentication is not.

## Progressive skill resources

Hosts with native skills load `skills/lemma-*/SKILL.md` and fetch linked `references/` or `scripts/` only as needed. Other MCP clients can request the `lemma_skill` prompt with `resource="procedure"`, `"reference"`, or `"script"`. This prompt is a knowledge resource and is not part of the action interface.
