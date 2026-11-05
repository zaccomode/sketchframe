# Sketchframe for VS Code

View `.sketchframe` design exports without leaving your editor. It's the same
viewer as the Sketchframe Mac app:

- **The frame's preview**, with outlines that follow each layer's shape:
  rotation, ovals, and rounded, smooth, angled and inside corners, each corner
  with its own radius. Hover a layer for a dashed outline, click it to select
  it.
- **An inspector** with the frame's layers, components, shared styles and color
  tokens. Each item's properties are grouped like a design tool's inspector
  (size, auto layout, typography, fills, borders, effects…), and clicking one
  copies its value, such as a color's hex. Switch to **JSON** for the full
  design JSON, coloured by your theme.
- **Annotations**: notes on layers for developers and AI agents, saved inside
  the Sketchframe and shared with the Mac app.

Sketchframes come from the Sketchframe plugin for Sketch. See the
[project on GitHub](https://github.com/zaccomode/sketchframe).

## Opening a Sketchframe

A `.sketchframe` is a folder, and VS Code only opens files in editors, so
there are two ways in:

- Open the package's `design.json`. It opens in the viewer; use **Reopen
  Editor With… → Text Editor** to see the raw JSON.
- Right-click the `.sketchframe` folder in the Explorer and choose **Open
  Sketchframe**.

## Using the viewer

- **Zoom** with the controls at the top right of the preview, by pinching, or
  with ⌘ or Ctrl and the scroll wheel. ⌘= / ⌘- / ⌘0 / ⌘9 zoom in, out, to
  actual size and to fit.
- **The sidebar** shows the inspector or the annotations. Switch with the
  buttons in the editor's title bar, or ⌥⌘I and ⌥⌘A. Drag its left edge to
  resize it.
- **Annotate** a layer by right-clicking it on the preview and choosing **Add
  Annotation**, or select it and press ⌥⌘N.

## Installing

Install it from the VS Code Marketplace, or download the `.vsix` from a
[GitHub release](https://github.com/zaccomode/sketchframe/releases) and use
**Extensions → … → Install from VSIX…**.

## Development

```bash
npm install
npm run build      # or: npm run watch
npm run typecheck
npm test           # model, outline, properties and theme tests, against test/fixtures
npm run package    # builds sketchframe-<version>.vsix
```

From the repository root, **Run → Start Debugging** (F5) opens an Extension
Development Host on `test/fixtures` with this extension loaded.

`webview/model.ts` is a port of the Mac app's `SketchframePackage.swift`,
`webview/outline.ts` of `Outline.swift`, and `webview/properties.ts` of
`PropertySections.swift`. Keep each pair in step; `docs/FORMAT.md` is the
shared reference.
