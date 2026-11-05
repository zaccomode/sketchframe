import * as vscode from 'vscode';
import type { ViewerCommand } from './protocol.ts';
import { Viewer } from './viewer.ts';

const viewType = 'sketchframe.viewer';

/** What a canvas context menu passes its commands (see `data-vscode-context`). */
type CanvasContext = { nodeId?: string } | undefined;

export function activate(context: vscode.ExtensionContext) {
  // A .sketchframe is a folder, and custom editors only open files, so the
  // editor is registered on the package's design.json. Opening that file (or
  // following a link to it) shows the viewer.
  const provider: vscode.CustomReadonlyEditorProvider = {
    openCustomDocument: (uri) => ({ uri, dispose() {} }),
    resolveCustomEditor: (document, panel) => {
      new Viewer(vscode.Uri.joinPath(document.uri, '..'), panel, context.extensionUri);
    },
  };

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(viewType, provider),
    vscode.commands.registerCommand('sketchframe.open', (uri?: vscode.Uri) => openPackage(uri, context)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('editor.wordWrap') || event.affectsConfiguration('workbench.colorTheme')) {
        void Viewer.refreshSettings();
      }
    }),
    vscode.window.onDidChangeActiveColorTheme(() => void Viewer.refreshSettings()),
  );

  const commands: Record<string, ViewerCommand> = {
    'sketchframe.zoomIn': 'zoomIn',
    'sketchframe.zoomOut': 'zoomOut',
    'sketchframe.zoomToFit': 'zoomToFit',
    'sketchframe.actualSize': 'actualSize',
    'sketchframe.toggleInspector': 'toggleInspector',
    'sketchframe.toggleAnnotations': 'toggleAnnotations',
    'sketchframe.addAnnotation': 'addAnnotation',
    'sketchframe.selectLayer': 'selectLayer',
  };
  for (const [id, command] of Object.entries(commands)) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (canvas: CanvasContext) => Viewer.active?.send(command, canvas?.nodeId)),
    );
  }
}

/** The Explorer's Open Sketchframe command on a .sketchframe folder. */
async function openPackage(uri: vscode.Uri | undefined, context: vscode.ExtensionContext) {
  uri ??= (
    await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      openLabel: 'Open Sketchframe',
    })
  )?.[0];
  if (!uri) return;

  const existing = Viewer.find(uri);
  if (existing) {
    existing.reveal();
    return;
  }

  const name = uri.path.split('/').pop()?.replace(/\.sketchframe$/, '') ?? 'Sketchframe';
  const panel = vscode.window.createWebviewPanel(viewType, name, vscode.ViewColumn.Active);
  new Viewer(uri, panel, context.extensionUri);
}

export function deactivate() {}
