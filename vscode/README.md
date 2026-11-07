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
- **Tools for agents**: the Sketchframe MCP server's tools (outline, layer
  details, screenshots, tokens, annotations, HTML/CSS) as language-model
  tools, so agents in VS Code can read Sketchframes in your workspace.

Sketchframes come from the Sketchframe plugin for Sketch. See the
[project on GitHub](https://github.com/zaccomode/sketchframe).

## Opening a Sketchframe

Open a `.sketchframe` file and it opens in the viewer. It works the same over
Remote SSH, in WSL and in Codespaces, and annotations are saved back into the
file.

Older Sketchframes are folders, and VS Code only opens files in editors, so
for those either open the folder's `design.json` (use **Reopen Editor With… →
Text Editor** to see the raw JSON), or right-click the `.sketchframe` folder in
the Explorer and choose **Open Sketchframe**.

## Using the viewer

- **Zoom** with the controls at the top right of the preview, by pinching, or
  with ⌘ or Ctrl and the scroll wheel. ⌘= / ⌘- / ⌘0 / ⌘9 zoom in, out, to
  actual size and to fit.
- **The sidebar** shows the inspector or the annotations. Switch with the
  buttons in the editor's title bar, or ⌥⌘I and ⌥⌘A. Drag its left edge to
  resize it.
- **Annotate** a layer by right-clicking it on the preview and choosing **Add
  Annotation**, or select it and press ⌥⌘N.

## Agent tools

The extension registers these tools for agents in VS Code (such as Copilot's
agent mode), the same ones the [`sketchframe` MCP server](../docs/agents.md)
provides: `sketchframe_list_sketchframes`, `sketchframe_get_outline`,
`sketchframe_get_node`, `sketchframe_get_screenshot`,
`sketchframe_get_tokens`, `sketchframe_get_annotations` and
`sketchframe_get_code`. File paths are relative to the first workspace folder,
and the tools read files on the machine the extension runs on. Screenshots are
saved to a temporary PNG whose path the tool returns.

## Installing

Install it from the VS Code Marketplace, or download the `.vsix` from a
[GitHub release](https://github.com/zaccomode/sketchframe/releases) and use
**Extensions → … → Install from VSIX…**.

## Development

```bash
npm install
npm run build      # or: npm run watch
npm run typecheck
npm test           # model, outline, properties, theme and tool tests, against test/fixtures
npm run package    # builds sketchframe-<version>.vsix
```

From the repository root, **Run → Start Debugging** (F5) opens an Extension
Development Host on `test/fixtures` with this extension loaded. The fixtures
have the same design as an archive (`Cards Archive.sketchframe`) and as a
folder.

The format, the archive and the agent tools come from
[`packages/core`](../packages/core), shared with the CLI and MCP server.

`webview/model.ts` is a port of the Mac app's `SketchframePackage.swift`,
`webview/outline.ts` of `Outline.swift`, and `webview/properties.ts` of
`PropertySections.swift`. Keep each pair in step; `docs/FORMAT.md` is the
shared reference.
