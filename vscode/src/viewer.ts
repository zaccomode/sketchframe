import * as vscode from 'vscode';
import { archiveFiles, text, updateArchive } from '../../packages/core/src/archive.ts';
import { ANNOTATIONS_FILE, DEFAULT_PREVIEW_FILE, DESIGN_FILE, isObject } from '../../packages/core/src/format.ts';
import { annotationsFileText } from '../webview/model.ts';
import type { SketchframeAnnotation } from '../webview/model.ts';
import type { HostMessage, ViewerCommand, ViewerSettings, WebviewMessage } from './protocol.ts';
import { jsonTokenColors } from './theme.ts';

/**
 * How a Sketchframe is stored: `archive` is the single-file zip (format v2),
 * `folder` the older package whose files sit in a directory.
 */
export type SketchframeKind = 'archive' | 'folder';

/**
 * One open Sketchframe in a webview: an archive opened as the custom editor
 * for `*.sketchframe`, or a folder package opened through its `design.json`
 * or with the Open Sketchframe command on the folder.
 */
export class Viewer implements vscode.Disposable {
  /** The viewer whose tab is active, which the toolbar commands act on. */
  static active: Viewer | undefined;
  private static readonly open = new Set<Viewer>();

  readonly packageUri: vscode.Uri;
  readonly kind: SketchframeKind;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly disposables: vscode.Disposable[] = [];
  private revision = 0;
  private reloadTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(packageUri: vscode.Uri, kind: SketchframeKind, panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.packageUri = packageUri;
    this.kind = kind;
    this.panel = panel;
    this.extensionUri = extensionUri;
    const webview = panel.webview;
    // An archive's preview reaches the webview as a data URI, so only a
    // folder needs to be readable from it.
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist'), ...(kind === 'folder' ? [packageUri] : [])],
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

    // Re-exporting from Sketch over an open Sketchframe rewrites it (or, for
    // a folder, these files in it).
    const watcher = vscode.workspace.createFileSystemWatcher(
      kind === 'archive'
        ? new vscode.RelativePattern(vscode.Uri.joinPath(packageUri, '..'), packageUri.path.split('/').pop() ?? '')
        : new vscode.RelativePattern(packageUri, '{design.json,annotations.json,*.png}'),
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
    let files: { design: string | undefined; annotations: string | undefined; previewUrl: string | null };
    try {
      files = this.kind === 'archive' ? await this.readArchive() : await this.readFolder();
    } catch (error) {
      this.post({ type: 'error', message: `This Sketchframe couldn't be read. ${error instanceof Error ? error.message : error}` });
      return;
    }
    if (files.design === undefined) {
      this.post({ type: 'error', message: 'This Sketchframe has no design.json.' });
      return;
    }
    this.post({
      type: 'load',
      design: files.design,
      annotations: files.annotations ?? null,
      previewUrl: files.previewUrl,
      canEditAnnotations: vscode.workspace.fs.isWritableFileSystem(this.packageUri.scheme) !== false,
    });
  }

  private async readArchive() {
    const files = archiveFiles(await vscode.workspace.fs.readFile(this.packageUri));
    const design = text(files, DESIGN_FILE);
    const src = previewSrc(design);
    const preview = files.read(src);
    return {
      design,
      annotations: text(files, ANNOTATIONS_FILE),
      previewUrl: preview ? `data:${imageType(src)};base64,${Buffer.from(preview).toString('base64')}` : null,
    };
  }

  private async readFolder() {
    const read = async (name: string) => {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.packageUri, name));
        return new TextDecoder().decode(bytes);
      } catch {
        return undefined;
      }
    };
    const design = await read(DESIGN_FILE);
    const preview = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.packageUri, previewSrc(design)));
    return {
      design,
      annotations: await read(ANNOTATIONS_FILE),
      // The query changes on every reload, so the webview re-fetches it.
      previewUrl: `${preview.toString()}?v=${++this.revision}`,
    };
  }

  private async sendSettings() {
    const wordWrap = vscode.workspace.getConfiguration('editor', { languageId: 'json' }).get<string>('wordWrap');
    const settings: ViewerSettings = { wordWrap: wordWrap !== undefined && wordWrap !== 'off', jsonColors: await jsonTokenColors() };
    this.post({ type: 'settings', settings });
  }

  /**
   * Writes annotations.json the way the Mac app does, or removes it when the
   * last annotation is deleted: into the archive, which is rewritten, or into
   * the folder. Through `vscode.workspace.fs`, so it also works over Remote
   * SSH and in Codespaces. The file watcher then reloads the viewer.
   */
  private async saveAnnotations(annotations: SketchframeAnnotation[]) {
    const contents = annotations.length > 0 ? annotationsFileText(annotations) : null;
    try {
      if (this.kind === 'archive') {
        const bytes = await vscode.workspace.fs.readFile(this.packageUri);
        await vscode.workspace.fs.writeFile(this.packageUri, updateArchive(bytes, { [ANNOTATIONS_FILE]: contents }));
        return;
      }
      const uri = vscode.Uri.joinPath(this.packageUri, ANNOTATIONS_FILE);
      if (contents !== null) {
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(contents));
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

/** design.json's `preview.src`, or the default when it can't be read. */
function previewSrc(design: string | undefined): string {
  try {
    const parsed: unknown = JSON.parse(design ?? '');
    if (isObject(parsed) && isObject(parsed.preview) && typeof parsed.preview.src === 'string') return parsed.preview.src;
  } catch {
    // Falls through to the default; the webview reports the unreadable design.
  }
  return DEFAULT_PREVIEW_FILE;
}

function imageType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif' || extension === 'webp') return `image/${extension}`;
  return 'image/png';
}
