import sketch from "sketch";
import { round } from "./utils/math";
import { createContext } from "./context";
import { walk, walkComponents } from "./walker";
import { extractSharedStyles, buildOutline } from "./postprocess";
// The manifest rather than package.json, which would bundle all of
// package.json's fields into the plugin along with the version. A default
// import: webpack 5 deprecates named imports from JSON modules.
import manifest from "./manifest.json";

// 2: the single-file archive. 1 was the folder package; the design is the same.
export const FORMAT_VERSION = 2;
/** scripts/bump-version.sh keeps the manifest in step with the release. */
export const PLUGIN_VERSION = manifest.version;
export const PREVIEW_FILE = "preview@2x.png";
const PREVIEW_SCALE = 2;

// Builds everything that goes into a .sketchframe for one layer.
export function exportFrame(layer) {
  const ctx = createContext(layer);
  const root = walk(layer, ctx, null);
  // Measured before extractSharedStyles, which replaces shared shadows and
  // borders on the nodes with style keys.
  const bounds = renderedBounds(root);
  const components = walkComponents(ctx);
  const componentRoots = Object.keys(components)
    .map((key) => components[key].root)
    .filter(Boolean);
  const styles = extractSharedStyles([root].concat(componentRoots));

  let preview = sketch.export(layer, {
    formats: ["png"],
    scales: String(PREVIEW_SCALE),
    trimmed: false,
    output: false,
  });
  if (Array.isArray(preview)) preview = preview[0];
  const previewSize = pngSize(preview);
  const origin = frameOriginInPreview(root, bounds, previewSize);

  const design = {
    format: "sketchframe",
    version: FORMAT_VERSION,
    generator: `sketchframe ${PLUGIN_VERSION} / Sketch ${sketch.version.sketch}`,
    exportedAt: new Date().toISOString(),
    name: layer.name,
    preview: {
      src: PREVIEW_FILE,
      scale: PREVIEW_SCALE,
      pixelWidth: previewSize && previewSize.width,
      pixelHeight: previewSize && previewSize.height,
      origin,
    },
    outline: buildOutline(root),
    tokens: Object.keys(ctx.colorTokens).length ? { colors: ctx.colorTokens } : undefined,
    styles,
    components: Object.keys(components).length ? components : undefined,
    root,
  };

  return { design, preview, assets: ctx.assets.files };
}

// Sketch renders shadows and outside/centre borders beyond a layer's bounds,
// including those of descendants (even inside a clipping frame), so the
// preview can be larger than the frame. Returns where the frame's top-left
// sits inside the preview, in points. The bounds are rounded outwards to
// whole points, as Sketch does. If they don't match the preview (e.g. rotated
// layers, which aren't measured), the difference is assumed to be split evenly.
function frameOriginInPreview(root, bounds, previewSize) {
  if (!previewSize) return undefined;
  const left = Math.floor(bounds.left);
  const top = Math.floor(bounds.top);
  const width = Math.ceil(bounds.right) - left;
  const height = Math.ceil(bounds.bottom) - top;

  const previewWidth = previewSize.width / PREVIEW_SCALE;
  const previewHeight = previewSize.height / PREVIEW_SCALE;
  const x = Math.abs(width - previewWidth) <= 1 ? -left : (previewWidth - root.width) / 2;
  const y = Math.abs(height - previewHeight) <= 1 ? -top : (previewHeight - root.height) / 2;
  return { x: round(x), y: round(y) };
}

// The area the root and its descendants draw into, in the root's coordinates:
// each node's frame, grown by its outer shadows and its outside/centre borders.
// Reads the walked design tree, where x/y are relative to the parent, so it
// must run before shared styles are extracted.
function renderedBounds(root) {
  const bounds = { left: 0, top: 0, right: root.width, bottom: root.height };
  const include = (left, top, right, bottom) => {
    bounds.left = Math.min(bounds.left, left);
    bounds.top = Math.min(bounds.top, top);
    bounds.right = Math.max(bounds.right, right);
    bounds.bottom = Math.max(bounds.bottom, bottom);
  };

  const visit = (node, parentX, parentY) => {
    const x = parentX + (node === root ? 0 : node.x || 0);
    const y = parentY + (node === root ? 0 : node.y || 0);
    const right = x + (node.width || 0);
    const bottom = y + (node.height || 0);

    const shadows = (node.effects && node.effects.shadows) || [];
    shadows
      .filter((shadow) => !shadow.inset)
      .forEach((shadow) => {
        const reach = (shadow.blur || 0) + (shadow.spread || 0);
        const dx = shadow.x || 0;
        const dy = shadow.y || 0;
        include(x + dx - reach, y + dy - reach, right + dx + reach, bottom + dy + reach);
      });
    (Array.isArray(node.borders) ? node.borders : []).forEach((border) => {
      const thickness = border.thickness || 0;
      const reach =
        border.position === "outside" ? thickness : border.position === "center" ? thickness / 2 : 0;
      include(x - reach, y - reach, right + reach, bottom + reach);
    });

    (node.children || []).forEach((child) => visit(child, x, y));
  };
  visit(root, 0, 0);
  return bounds;
}

// Width and height live at bytes 16..23 of the PNG IHDR chunk.
function pngSize(buffer) {
  try {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch (e) {
    return undefined;
  }
}
