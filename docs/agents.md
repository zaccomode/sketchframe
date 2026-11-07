# Sketchframe for AI agents

A `.sketchframe` holds everything an agent needs to build a design: the frame
rendered as a PNG, and the full design tree with positions, sizes, styles,
stack layouts, components, color tokens and designers' annotations. Rather
than hand an agent the whole `design.json`, the Sketchframe tools give it
targeted views, modelled on Figma's MCP server:

| Tool (MCP) | CLI | What it gives |
|---|---|---|
| `list_sketchframes` | `sketchframe list [dir]` | The `.sketchframe` files under a directory |
| `get_outline` | `sketchframe outline <file> [node] [--depth N]` | One line per layer: name, type, position, size, id; components ◆, rotation ↻, annotations ✎ |
| `get_node` | `sketchframe node <file> <node> [--depth N]` | One layer's subtree with shared styles resolved inline, its bounds, its parent's layout, the tokens it uses and the annotations on it |
| `get_screenshot` | `sketchframe crop <file> [node] [-o out.png] [--padding N]` | The preview, or the region showing one layer, as a PNG |
| `get_tokens` | `sketchframe tokens <file>` | Color tokens, Sketch shared styles and reused style values, each with the layers that use it |
| `get_annotations` | `sketchframe annotations <file>` | Designers' notes with the layers they're attached to |
| `get_code` | `sketchframe code <file> <node>` | An HTML/CSS starting point for a layer: stacks as flexbox, tokens as CSS variables |
| | `sketchframe cat <file>` | A stable text rendering, for `git diff` |
| | `sketchframe extract <file> <dir>` / `pack <dir> <file>` | Convert between the archive and a folder |

A `<node>` is an id from the outline (`n4`), a `sketchId`, a layer path from
the frame's children down (`Header/Title`), or a unique layer name. Every
tool reads both the single-file archive and older folder packages.

The tools are one npm package, [`sketchframe`](https://www.npmjs.com/package/sketchframe):
`sketchframe mcp` (or `sketchframe-mcp`) starts the MCP server on stdio. It's
pure JavaScript with no dependencies, so it runs anywhere Node 18+ runs,
including Linux containers with no macOS tools.

## Setting a repository up

From the root of the repository that holds your `.sketchframe` files:

```bash
npx sketchframe init
git add .mcp.json .claude/skills/sketchframe .gitattributes
git commit -m "Set up Sketchframe for Claude Code"
```

`init` writes three files, merging with any that already exist:

- **`.mcp.json`**: the MCP server, run through `npx`:

  ```json
  {
    "mcpServers": {
      "sketchframe": { "command": "npx", "args": ["-y", "sketchframe", "mcp"] }
    }
  }
  ```

- **`.claude/skills/sketchframe/SKILL.md`**: the [skill](../skills/sketchframe/SKILL.md),
  which teaches Claude the workflow (outline → screenshot → annotations →
  node and crop for each layer → tokens) and falls back to the CLI, then to
  `unzip`, when the MCP server isn't connected.
- **`.gitattributes`**: `*.sketchframe diff=sketchframe`, for the
  [diff driver](#git-diffs).

Then commit your `.sketchframe` files too. Agents can only read what's in the
repository.

### Claude Code on the web

A cloud session is a fresh Linux container with your repository cloned into
it, and none of your Mac's setup. Everything above is configured from
committed files, so it works there unchanged:

- The MCP server and skill come from `.mcp.json` and `.claude/skills`.
- `npx` installs `sketchframe` from the npm registry, which cloud environments
  allow by default. If your environment's network is locked down further,
  allow `registry.npmjs.org`, or commit the bundle (below).
- Screenshots reach Claude as images in the MCP tool result. Through the
  CLI, `sketchframe crop` writes a PNG that Claude opens with its Read tool.
- Commit `.sketchframe` files normally rather than through Git LFS, which the
  cloud environment would also have to support.

### With no network at all

Each [GitHub release](https://github.com/zaccomode/sketchframe/releases)
carries `sketchframe-<version>.cjs`: the CLI and MCP server in one file with
no dependencies. Commit it (for example as `tools/sketchframe.cjs`) and point
`.mcp.json` at it:

```json
{
  "mcpServers": {
    "sketchframe": { "command": "node", "args": ["tools/sketchframe.cjs", "mcp"] }
  }
}
```

The CLI is then `node tools/sketchframe.cjs outline Design.sketchframe`.

### With no tools

A `.sketchframe` is a zip, so `unzip -p Design.sketchframe design.json` or
`python3 -m zipfile -e Design.sketchframe out/` always works.
[FORMAT.md](FORMAT.md) describes every field.

## Other MCP clients

Any MCP client that runs stdio servers can use it: run `npx -y sketchframe
mcp` with the repository as the working directory. Relative file paths in
tool calls resolve against that directory.

## VS Code

The [VS Code extension](../vscode/README.md) registers the same tools as
language-model tools (`sketchframe_get_outline` and so on), so agents in VS
Code can use them without the MCP server. Paths are relative to the first
workspace folder.

## Git diffs

A `.sketchframe` is binary to git. With the diff driver, `git diff` shows
changes to `design.json` and `annotations.json` as text instead. Add the
attribute (which `sketchframe init` does):

```gitattributes
*.sketchframe diff=sketchframe
```

and, once per clone, tell git how to convert the file to text:

```bash
git config diff.sketchframe.textconv "npx -y sketchframe cat"
```

`sketchframe cat` leaves out `exportedAt`, so a re-export that didn't change
the design shows no diff.
