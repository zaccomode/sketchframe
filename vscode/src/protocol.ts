// Messages between the extension host and the viewer webview. Both bundles
// import this file, so it holds types only.

import type { SketchframeAnnotation } from '../webview/model.ts';

export type ViewerCommand =
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomToFit'
  | 'actualSize'
  | 'toggleInspector'
  | 'toggleAnnotations'
  | 'addAnnotation'
  | 'selectLayer';

/** JSON token colours from the active VS Code theme; missing ones fall back to CSS. */
export type JSONColors = { key?: string; string?: string; number?: string; constant?: string };

export type ViewerSettings = {
  /** `editor.wordWrap` for JSON is anything but `off`. */
  wordWrap: boolean;
  jsonColors: JSONColors;
};

export type HostMessage =
  | {
      type: 'load';
      /** design.json's text. */
      design: string;
      /** annotations.json's text, if the package has one. */
      annotations: string | null;
      /** The package folder as a webview URI, with no trailing slash. */
      baseUri: string;
      /** Changes on every reload, so the webview re-fetches the preview. */
      revision: number;
      /** False when the package is on a read-only file system. */
      canEditAnnotations: boolean;
    }
  | { type: 'settings'; settings: ViewerSettings }
  | { type: 'error'; message: string }
  /** `nodeId` is the layer a canvas context menu was opened on. */
  | { type: 'command'; command: ViewerCommand; nodeId?: string };

export type WebviewMessage = { type: 'ready' } | { type: 'saveAnnotations'; annotations: SketchframeAnnotation[] };
