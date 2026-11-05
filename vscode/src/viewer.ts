import * as vscode from 'vscode';
import { annotationsFileText } from '../webview/model.ts';
import type { SketchframeAnnotation } from '../webview/model.ts';
import type { HostMessage, ViewerCommand, ViewerSettings, WebviewMessage } from './protocol.ts';
import { jsonTokenColors } from './theme.ts';

/**
 * One open Sketchframe: a webview showing a package folder, whether it was
 * opened as the custom editor for `design.json` or with the Open Sketchframe
 * command on the folder.
 */
export class Viewer implements vscode.Disposable {
  /** The viewer whose tab is active, which the toolbar commands act on. */
  static active: Viewer | undefined;
  private static readonly open = new Set<Viewer>();

  readonly packageUri: vscode.Uri;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private revision = 0;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(packageUri: vscode.Uri, panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.packageUri = packageUri;
    this.panel = panel;
    this.extensionUri = extensionUri;
    const webview = panel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist'), packageUri],
    };
    webview.html = this.html(webview);

    this.disposables.push(
      webview.onDidReceiveMessage((message: WebviewMessage) => {
        switch (message.type) {
          case 'ready':
            void this.sendSettings();
            void this.load();
            break;
          case 'saveAnnotations':
            void this.saveAnnotations(message.annotations);
            break;
        }
      }),
      panel.onDidChangeViewState(() => this.updateActive()),
      panel.onDidDispose(() => this.dispose()),
    );

    // Re-exporting from Sketch over an open package rewrites these files.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(packageUri, '{design.json,annotations.json,*.png}'),
    );
    const reload = () => this.scheduleReload();
    watcher.onDidChange(reload);
    watcher.onDidCreate(reload);
    watcher.onDidDelete(reload);
    this.disposables.push(watcher);

    Viewer.open.add(this);
    this.updateActive();
  }

  static find(packageUri: vscode.Uri): Viewer | undefined {
    return [...Viewer.open].find((viewer) => viewer.packageUri.toString() === packageUri.toString());
  }

  /** After the theme or `editor.wordWrap` changes. */
  static async refreshSettings() {
    await Promise.all([...Viewer.open].map((viewer) => viewer.sendSettings()));
  }

  reveal() {
    this.panel.reveal();
  }

  send(command: ViewerCommand, nodeId?: string) {
    this.post({ type: 'command', command, nodeId });
  }

  dispose() {
    clearTimeout(this.reloadTimer);
    Viewer.open.delete(this);
    if (Viewer.active === this) {
      Viewer.active = undefined;
      void vscode.commands.executeCommand('setContext', 'sketchframe.viewerFocused', false);
    }
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }

  private updateActive() {
    if (this.panel.active) {
      Viewer.active = this;
    } else if (Viewer.active === this) {
      Viewer.active = undefined;
    }
    void vscode.commands.executeCommand('setContext', 'sketchframe.viewerFocused', Viewer.active !== undefined);
  }

  /** A re-export writes several files in a row; reload once they've settled. */
  private scheduleReload() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => void this.load(), 150);
  }

  private async load() {
    const read = async (name: string) => {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.packageUri, name));
        return new TextDecoder().decode(bytes);
      } catch {
        return null;
      }
    };

    const design = await read('design.json');
    if (design === null) {
      this.post({ type: 'error', message: 'This Sketchframe has no design.json.' });
      return;
    }
    this.post({
      type: 'load',
      design,
      annotations: await read('annotations.json'),
      baseUri: this.panel.webview.asWebviewUri(this.packageUri).toString().replace(/\/$/, ''),
      revision: ++this.revision,
      canEditAnnotations: vscode.workspace.fs.isWritableFileSystem(this.packageUri.scheme) !== false,
    });
  }

  private async sendSettings() {
    const wordWrap = vscode.workspace.getConfiguration('editor', { languageId: 'json' }).get<string>('wordWrap');
    const settings: ViewerSettings = { wordWrap: wordWrap !== undefined && wordWrap !== 'off', jsonColors: await jsonTokenColors() };
    this.post({ type: 'settings', settings });
  }

  /**
   * Writes annotations.json the way the Mac app does, or removes it when the
   * last annotation is deleted. The file watcher then reloads the viewer.
   */
  private async saveAnnotations(annotations: SketchframeAnnotation[]) {
    const uri = vscode.Uri.joinPath(this.packageUri, 'annotations.json');
    try {
      if (annotations.length > 0) {
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(annotationsFileText(annotations)));
      } else {
        await vscode.workspace.fs.delete(uri).then(undefined, () => {});
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Couldn't save annotations: ${error instanceof Error ? error.message : error}`);
      void this.load();
    }
  }

  private post(message: HostMessage) {
    void this.panel.webview.postMessage(message);
  }

  private html(webview: vscode.Webview) {
    const dist = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', file));
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${dist('webview.css')}">
</head>
<body>
  <script nonce="${nonce}" src="${dist('webview.js')}"></script>
</body>
</html>`;
  }
}
