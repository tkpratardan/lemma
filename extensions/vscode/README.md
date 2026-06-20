# Lemma VS Code extension

Lets an MCP agent edit and run the notebook open in VS Code or Cursor, live in the editor.

## Settings

Permission gates after the agent makes edits to the file.

- **Accept** — the edit is kept, the diff tab closes, and the agent continues.
- **Always Allow** — accepts this edit and stops prompting for the rest of the current editor session (window). This does not change the `lemma.confirmEdits` setting: a fresh window, or reopening the editor, prompts again.
- **Discard, closing the diff tab without choosing, or dismissing the dialog any other way (e.g. Escape)** — the edit is reverted, and the agent receives `"edit discarded by user"`, stopping it from retrying that change. Only an explicit Accept or Always Allow keeps an edit.

After Accept or Always Allow, the notebook scrolls to and selects the changed cell so you see the result immediately, without stealing focus from wherever you were.

Turn it off for zero-friction flow (Claude Code's own permission allow-list already pre-approves `vscode_*` tools on the assumption this gate is on) and use **Cmd+Z** to undo instead:

```json
"lemma.confirmEdits": false
```
