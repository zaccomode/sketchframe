---
name: sketchframe
description: Build UI from .sketchframe design files exported from Sketch. Use whenever a task mentions a .sketchframe file, a Sketch design or frame to implement, or asks to match a design, and the repository contains .sketchframe files.
---

# Building from a Sketchframe

A `.sketchframe` is a design exported from Sketch: a rendered preview of one
frame plus the full design tree (positions, sizes, fills, borders, effects,
typography, stack layouts, components, color tokens) and notes designers left
on layers. It is a zip archive (older exports are folders with the same
files inside).

Don't eyeball the preview alone, and don't read the whole `design.json`
either: it can be huge. Use the tools to look at the outline, then pull the
details of only the layers you're building.

## Tools, in order of preference

1. **MCP tools** (`sketchframe` server): `list_sketchframes`, `get_outline`,
   `get_node`, `get_screenshot`, `get_annotations`, `get_tokens`, `get_code`.
2. **CLI**, when the MCP server isn't connected. Run it with
   `npx -y sketchframe <command>` (or `sketchframe` if installed, or
   `node path/to/sketchframe.cjs` if the repository commits the bundle):

   | MCP tool | CLI |
   |---|---|
   | `list_sketchframes` | `sketchframe list [dir]` |
   | `get_outline` | `sketchframe outline <file> [node] [--depth N]` |
   | `get_node` | `sketchframe node <file> <node> [--depth N]` |
   | `get_screenshot` | `sketchframe crop <file> [node] [-o out.png] [--padding N]`, then open the PNG with your Read tool |
   | `get_annotations` | `sketchframe annotations <file>` |
   | `get_tokens` | `sketchframe tokens <file>` |
   | `get_code` | `sketchframe code <file> <node>` |

3. **No tools at all**: it's a zip.
   `unzip -p Design.sketchframe design.json`, or
   `python3 -m zipfile -e Design.sketchframe out/` and look at
   `out/preview@2x.png`. `docs/FORMAT.md` in the Sketchframe repository
   describes every field. (An older export is a folder; read its files
   directly.)

A `<node>` is an id from the outline (`n4`), a `sketchId`, a layer path from
the frame's children down (`Header/Title`), or a unique layer name.

## Workflow

1. **Find the file** with `list_sketchframes` if you weren't given one.
2. **Get the outline** (`get_outline`) and **look at the whole frame**
   (`get_screenshot` with no node). The outline gives every layer's name,
   type, position relative to its parent, size and id, and marks component
   instances (◆), rotation (↻) and annotated layers (✎).
3. **Read the annotations** (`get_annotations`). They are instructions from
   the designer about specific layers (behaviour, accessibility, content,
   implementation notes, "this is a mistake"). Follow them; they override
   what the design shows.
4. **Pick the layers to build**: usually the frame's direct children or the
   distinct sections, not every leaf.
5. For each, **pull its context** (`get_node`) and **its screenshot**
   (`get_screenshot` with the node, maybe `padding` for context).
   `get_node` resolves shared styles inline, lists the tokens it uses with
   their values, includes its parent's layout, and the annotations on it.
   Use `depth` on large subtrees and fetch deeper children by id.
6. **Map tokens** (`get_tokens`) onto the codebase's own design variables
   (CSS custom properties, Tailwind theme, Swift/Compose color assets)
   instead of hard-coding hex values. Reuse existing components where a
   Sketch component (instance `component` name) matches one.
7. Optionally use **`get_code`** for an HTML/CSS starting point for a layer,
   then adapt it to the codebase's framework and conventions.
8. **Compare** what you built against the screenshots.

## Reading the values

- Units are points (CSS px). `x`/`y` are relative to the parent node.
- Stacks (`layout`) are flexbox: `mode` row/column, `gap`, `padding`,
  `justifyContent`, `alignItems`. Children with `position: "absolute"` sit
  outside the flow. `sizing` of `fill`/`hug`/`fixed` maps to
  `flex: 1`/`fit-content`/fixed size.
- `fills` and `borders` are listed **top-most first**, like CSS backgrounds.
- `effects.css` already holds ready-made `boxShadow` / `filter` /
  `backdropFilter` values.
- Paints with `approximate: true` can't be expressed exactly in CSS; trust
  the screenshot for those.
- `textStyle.fontWeight` is CSS (100–900); `lineHeight` and `letterSpacing`
  are px. `textRuns` lists ranges styled differently.
- Instances (`type: "instance"`) carry `component` (the symbol's name) and
  their resolved children; the symbol's own definition is in `components`.
- Image and vector layers have `src` paths to files inside the archive
  (`assets/…`); extract them with `sketchframe extract` if you need the
  originals.
