// Lemma VS Code extension entry point. Runs a local HTTP bridge so any MCP
// agent (Claude Code, Cursor chat, Windsurf, …) can drive the active notebook
// natively, live: the IDE counterpart of the CLI/JupyterLab modalities.
import * as vscode from 'vscode';
import { NotebookBridge } from './bridge';

let bridge: NotebookBridge | undefined;

export function activate(context: vscode.ExtensionContext) {
  // Local HTTP bridge: lets external MCP agents (Claude Code, Cursor chat,
  // Windsurf) drive this editor's notebook live. Edits land in-editor via
  // `NotebookEdit`, so no disk-write conflict.
  bridge = new NotebookBridge();
  bridge.start();
  context.subscriptions.push({ dispose: () => bridge?.stop() });

  console.log('Lemma: notebook bridge listening');
}

export function deactivate() {
  bridge?.stop();
}
