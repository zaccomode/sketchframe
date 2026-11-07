# sketchframe

Read `.sketchframe` design files from the command line or an MCP server.
Sketchframes are exported from Sketch by the
[Sketchframe plugin](https://github.com/zaccomode/sketchframe): a rendered
preview of a frame plus its full design tree, for handing designs to AI
agents.

```bash
npx sketchframe outline Checkout.sketchframe
npx sketchframe node Checkout.sketchframe Header/Title
npx sketchframe crop Checkout.sketchframe n12 -o title.png
npx sketchframe mcp          # the MCP server, on stdio
npx sketchframe init         # set a repository up for Claude Code
```

| Command | MCP tool | What it gives |
|---|---|---|
| `list [dir]` | `list_sketchframes` | The `.sketchframe` files under a directory |
| `outline <file> [node] [--depth N]` | `get_outline` | A compact tree of names, types, positions, sizes and ids |
| `node <file> <node> [--depth N]` | `get_node` | One layer's subtree with styles resolved, its tokens and annotations |
| `crop <file> [node] [-o out.png] [--padding N]` | `get_screenshot` | The preview, or one layer's region of it, as a PNG |
| `tokens <file>` | `get_tokens` | Color tokens, shared styles and reused style values |
| `annotations <file>` | `get_annotations` | Designers' notes, with their layers |
| `code <file> <node>` | `get_code` | An HTML/CSS starting point for a layer |
| `cat <file>` | | A stable text rendering, for `git diff` |
| `extract <file> <dir>`, `pack <dir> <file>` | | Convert between the archive and a folder |
| `init [dir]` | | Write `.mcp.json`, the Claude skill and `.gitattributes` |
| `skill` | | Print the Claude skill |

No dependencies, no native modules and no macOS tools: it runs anywhere
Node 18+ does, including Claude Code on the web.

See [docs/agents.md](https://github.com/zaccomode/sketchframe/blob/main/docs/agents.md)
for setting a repository up, and
[docs/FORMAT.md](https://github.com/zaccomode/sketchframe/blob/main/docs/FORMAT.md)
for the format.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build      # dist/sketchframe.cjs and dist/sketchframe-mcp.cjs
```

The format and the operations live in [`packages/core`](../core), which the
VS Code extension shares.
