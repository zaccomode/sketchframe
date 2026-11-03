# The `.sketchframe` format (v1)

A `.sketchframe` is a **directory** that macOS shows as a single file. Its
UTI is `com.isaacshea.sketchframe`, which conforms to `com.apple.package`.
Agents can read the files inside directly. Finder users get a Quick Look preview.

```
Checkout.sketchframe/
├── README.md          how to read the package (for agents that land here)
├── design.json        the design tree (this document)
├── preview@2x.png     the frame rendered at 2x
└── assets/
    ├── img_<hash>.png|jpg|…   original image bytes (image layers, image fills)
    └── vec_<hash>.svg         vectors and shape-only groups, rendered by Sketch
```

All `src` paths are relative to the package root.

## `design.json`

```jsonc
{
  "format": "sketchframe",
  "version": 1,
  "generator": "sketchframe 0.1.0 / Sketch 2026.2",
  "exportedAt": "2026-11-03T08:00:00.000Z",
  "name": "Checkout",
  "preview": { "src": "preview@2x.png", "scale": 2, "pixelWidth": 750, "pixelHeight": 1624, "origin": { "x": 0, "y": 0 } },
  "outline": ["Checkout [frame] 375×812 n1", "  Header [frame] 0,0 375×96 n2", "…"],
  "tokens": { "colors": { "Primary/500": "#3b5bdb" } },
  "styles": { "fill_9d1e44a0": [{ "type": "solid", "color": "#ffffff" }] },
  "components": { "8E1F…": { "name": "Button/Primary", "library": "Core UI", "root": { /* Node */ } } },
  "root": { /* Node */ }
}
```

| Key | Meaning |
|---|---|
| `preview` | The rendered frame. If the layer has shadows or outside borders that extend past its bounds, the PNG is larger than `width × scale`. `origin` is where the frame's top-left sits inside the preview, in points (e.g. `{ x: 24, y: 16 }` for a `0 8 24` drop shadow). |
| `outline` | One line per node, indented two spaces per depth level: `name [type] x,y w×h id`. Read this first to find a subtree. |
| `tokens.colors` | The swatches (color variables) the frame uses: name → CSS color. Nodes refer to them through `token` / `colorToken`. |
| `styles` | Style values that two or more nodes share. A node field that holds a **string** instead of an object or array is a key into this map. |
| `components` | The symbols the frame uses, keyed by Sketch symbol ID: `{ name, library?, root }`. `root` is the symbol master as a Node tree in its own coordinate space. Nested symbols are included. |
| `root` | The exported layer. |

## Node

Fields are omitted when they hold the default value.

| Field | Notes |
|---|---|
| `id` | `n1`, `n2`, … unique within the file, in depth-first order. |
| `name` | Sketch layer name. |
| `type` | `frame` · `graphic` · `group` · `instance` · `text` · `image` · `rectangle` · `oval` · `vector` |
| `x`, `y` | Points, relative to the parent node. The root has none. |
| `width`, `height` | Points. |
| `rotation` | Degrees, CSS convention (positive = clockwise). |
| `flipX`, `flipY` | `true` if the layer is flipped. |
| `position` | `"absolute"` for a stack child that ignores the stack layout. |
| `sizing` | `{ horizontal, vertical }`, each one of `fixed` · `hug` · `fill` · `relative`. |
| `minSize`, `maxSize`, `percentageSize` | `{ width, height }`. |
| `constraints` | `{ horizontal: left|right|left-right|scale, vertical: top|bottom|top-bottom|scale }`. Only present when the node is not in stack flow. |
| `opacity` | 0–1. |
| `blendMode` | CSS `mix-blend-mode` name. |
| `sharedStyle` | Name of the Sketch shared layer or text style. |
| `fills` | Paint[], **top-most first** (CSS background order). |
| `borders` | Border[], top-most first. |
| `borderOptions` | `{ dashPattern, lineCap, lineJoin, startArrowhead, endArrowhead }`. |
| `corners` | `{ radius: n | [tl, tr, br, bl], style?: "smooth"|"angled"|"insideSquare"|"insideArc", smoothing?, concentric? }`. |
| `effects` | `{ shadows[], blurs[], progressiveAlpha?, css: { boxShadow?|textShadow?, filter?, backdropFilter? } }`. |
| `layout` | Only on stacks. Flexbox: `{ mode: row|column, justifyContent, alignItems, gap, padding, wrap, alignContent, crossAxisGap, stackingOrder, bordersAffectLayout }`. |
| `clipContent` | `true` if children are clipped to the bounds. |
| `component`, `componentId` | For `instance`: the symbol's name, and its key in `components`. The instance's own style fields are the symbol's, with overrides applied, and its `children` are the symbol's resolved layers. |
| `overrides` | For `instance`: the overrides that differ from the symbol, as `[{ layer, property, value }]` (e.g. `{ "layer": "Cube1", "property": "color:fill-0", "value": "#00ff3c" }`). |
| `src` | For `image` and `vector`: an asset path. |
| `children` | Node[]. Painted back to front (DOM order). Inside a stack, in-flow children come first, in main-axis order. |

### Text nodes

| Field | Notes |
|---|---|
| `text` | The string, with `\n` line breaks. |
| `textBehaviour` | `auto-width` · `fixed-width` |
| `textStyle` | `{ fontFamily, fontName (PostScript name), fontWeight (CSS 100–900), sketchFontWeight (0–12), fontStyle, fontSize, lineHeight (px), lineHeightAuto, letterSpacing (px), paragraphSpacing, textTransform, textAlign, verticalAlign, color, colorToken, textDecoration }` |
| `textRuns` | Present only when ranges of the text are formatted differently. Each run has `text` and only the properties that differ from `textStyle`. |

### Paint

```jsonc
{ "type": "solid", "color": "#3b5bdb", "token": "Primary/500" }
{ "type": "linear", "css": "linear-gradient(180deg, #fff 0%, #000 100%)",
  "from": { "x": 0.5, "y": 0 }, "to": { "x": 0.5, "y": 1 },
  "stops": [{ "position": 0, "color": "#ffffff" }, { "position": 1, "color": "#000000" }] }
{ "type": "radial" | "angular", "css": "…", "approximate": true, … }
{ "type": "image", "src": "assets/img_1a2b3c4d.png", "fit": "cover|contain|stretch|tile", "tileScale": 1 }
```

`from` / `to` are in the layer's unit box (0–1). Linear `css` is exact.
`approximate: true` marks paints that CSS can't express exactly (rotated
elliptical radials, angular gradients). For those, trust the preview.

Borders are a Paint plus `{ position: inside|center|outside, thickness, sides? }`.

### Shadows and blurs

```jsonc
{ "x": 0, "y": 4, "blur": 12, "spread": 0, "color": "rgba(0, 0, 0, 0.12)", "inset": true }
{ "type": "gaussian" | "background" | "glass" | "motion" | "zoom", "radius": 20, … ,
  "progressive": { "from", "to", "stops": [{ "position", "alpha" }] } }
```

Glass blurs add `brightness`, `distortion`, `depth`, `chromaticAberration`,
`saturation` and `specularHighlights`.
