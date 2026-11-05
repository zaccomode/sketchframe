# Sketchframe for VS Code

Views `.sketchframe` design exports inside VS Code: the frame's preview with
layer outlines, and an inspector with its layers, components, shared styles and
color tokens. It's the same viewer as the Sketchframe Mac app.

## Opening a Sketchframe

A `.sketchframe` is a folder, and VS Code only opens files in editors, so
there are two ways in:

- Open the package's `design.json`. It opens in the viewer; use **Reopen
  Editor With… → Text Editor** to see the raw JSON.
- Right-click the `.sketchframe` folder in the Explorer and choose **Open
  Sketchframe**.

While a viewer is focused, the zoom and inspector buttons sit in the editor's
title bar, with the same shortcuts as the Mac app (⌘= / ⌘- / ⌘0 / ⌘9, ⌥⌘I).

## Development

```bash
npm install
npm run build      # or: npm run watch
npm run typecheck
npm test           # model and geometry tests, against test/fixtures
```

From the repository root, **Run → Start Debugging** (F5) opens an Extension
Development Host on `test/fixtures` with this extension loaded.

`webview/model.ts` is a port of the Mac app's `SketchframePackage.swift`.
Keep the two in step; `docs/FORMAT.md` is the shared reference.
