# Sketchframe: A Sketch Details Exporter

_Sketchframe_ is a neat little toolkit to export (and then view) `.sketchframe` files, which are a custom filetype that contains both a visual image of a given frame, and a detailed JSON structure of the containing Sketch design. Sketchframes contain design information like colours, relative positions, design tokens, etc., and can include free-text annotations to help developers understand your work.

Sketchframes are especially useful for folks who utilise AI in their work, as this allows you to hand your agents rich, detailed information about your designs, rather than having them pixel-peep a flat image.

## The Sketch Plugin

To create a Sketchframe, you'll need to install the Sketch plugin.

To export a frame as a `.sketchframe`, use Plugins > Sketchframe > Export Selected Frame..., then select the destination folder.

A `.sketchframe` is a single file (a zip archive, like `.docx` or `.sketch`), so it can be shared through Slack, email or any cloud storage, and committed to git. Without the Sketchframe app it can be opened like any zip archive. Older exports are folders with the same files inside; everything below still reads those, and re-exporting over one replaces it with a single file.

## The Sketchframe App

To view a `.sketchframe` file, you'll need to install the Sketchframe macOS application. This gives you a dedicated viewing app and a Quick Look Finder extension.

The Sketchframe application also contains a surface for you to annotate your designs, allowing you to provide explanations or additional details that are best kept alongside your design.

## The VS Code Extension

You can also view and annotate Sketchframes inside VS Code, with the same layout as the app. It also gives agents in VS Code the same tools as the MCP server. Install _Sketchframe_ from the VS Code Marketplace, or download the `.vsix` from a [release](https://github.com/zaccomode/sketchframe/releases). See [vscode/README.md](vscode/README.md) for how to open one.

## Working with AI

Sketchframes are made for handing designs to AI agents. The [`sketchframe`](packages/cli/README.md) npm package gives agents targeted tools, modelled on Figma's MCP server, instead of a raw dump of the design: an outline of the layer tree, one layer's full design context, a screenshot of one layer, the design's color tokens and its annotations. It's both a CLI and an MCP server, and it runs anywhere Node does, including Claude Code on the web.

To set a repository up for Claude Code, run this in it and commit the result:

```bash
npx sketchframe init
```

That adds the MCP server to `.mcp.json`, a Claude skill that teaches the workflow, and a git diff driver so `git diff` shows design changes as text. See [docs/agents.md](docs/agents.md) for the details, including setups with no network access.

Agents without the tools can still read a Sketchframe with `unzip -p Design.sketchframe design.json`; every file comes bundled with a README explaining how. The format is documented in [docs/FORMAT.md](docs/FORMAT.md).
