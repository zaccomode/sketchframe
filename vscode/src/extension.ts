import * as vscode from 'vscode';
import { registerLanguageModelTools } from './tools.ts';
import type { ViewerCommand } from './protocol.ts';
import { Viewer } from './viewer.ts';

const viewType = 'sketchframe.viewer';

/** What a canvas context menu passes its commands (see `data-vscode-context`). */
type CanvasContext = { nodeId?: string } | undefined;

export function activate(context: vscode.ExtensionContext) {
  // A .sketchframe is a single-file archive, which the editor opens
  // directly. Older ones are folders, and custom editors only open files, so
  // the editor is also registered on a folder package's design.json.
  const provider: vscode.CustomReadonlyEditorProvider = {
    openCustomDocument: (uri) => ({ uri, dispose() {} }),
    resolveCustomEditor: (document, panel) => {
      if (document.uri.path.endsWith('/design.json')) {
        new Viewer(vscode.Uri.joinPath(document.uri, '..'), 'folder', panel, context.extensionUri);
      } else {
        new Viewer(document.uri, 'archive', panel, context.extensionUri);
      }
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
    ...registerLanguageModelTools(),
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

/** The Explorer's Open Sketchframe command on a .sketchframe file or folder. */
async function openPackage(uri: vscode.Uri | undefined, context: vscode.ExtensionContext) {
  uri ??= (
    await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: true,
      filters: { Sketchframe: ['sketchframe'] },
      openLabel: 'Open Sketchframe',
    })
  )?.[0];
  if (!uri) return;

  // An archive is a file, which the custom editor opens like any other.
  const stat = await vscode.workspace.fs.stat(uri);
  if ((stat.type & vscode.FileType.Directory) === 0) {
    await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
    return;
  }

  const existing = Viewer.find(uri);
  if (existing) {
    existing.reveal();
    return;
  }

  const name = uri.path.split('/').pop()?.replace(/\.sketchframe$/, '') ?? 'Sketchframe';
  const panel = vscode.window.createWebviewPanel(viewType, name, vscode.ViewColumn.Active);
  new Viewer(uri, 'folder', panel, context.extensionUri);
}

export function deactivate() {}
