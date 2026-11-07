import sketch from "sketch";
import { Style } from "sketch/dom";
import { enumKey } from "./utils/enums";
import { round } from "./utils/math";
import { createContext } from "./context";
import { walk, walkComponents } from "./walker";
import { extractSharedStyles, buildOutline } from "./postprocess";
// The manifest rather than package.json, which would bundle all of
// package.json's fields into the plugin along with the version.
import { version } from "./manifest.json";

// 2: the single-file archive. 1 was the folder package; the design is the same.
export const FORMAT_VERSION = 2;
/** scripts/bump-version.sh keeps the manifest in step with the release. */
export const PLUGIN_VERSION = version;
export const PREVIEW_FILE = "preview@2x.png";
const PREVIEW_SCALE = 2;

// Builds everything that goes into a .sketchframe for one layer.
export function exportFrame(layer) {
  const ctx = createContext(layer);
  const root = walk(layer, ctx, null);
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
  const origin = frameOriginInPreview(layer, previewSize);

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

// Sketch renders shadows and outside borders beyond the layer's bounds, so the
// preview can be larger than the frame. Returns where the frame's top-left
// sits inside the preview, in points. If the measured overflow doesn't match
// the preview (e.g. unclipped children also overflow), the difference is
// assumed to be split evenly.
function frameOriginInPreview(layer, previewSize) {
  if (!previewSize) return undefined;
  const style = layer.style || {};
  const outset = { left: 0, top: 0, right: 0, bottom: 0 };
  const extend = (left, top, right, bottom) => {
    outset.left = Math.max(outset.left, left);
    outset.top = Math.max(outset.top, top);
    outset.right = Math.max(outset.right, right);
    outset.bottom = Math.max(outset.bottom, bottom);
  };

  (style.shadows || [])
    .filter((shadow) => shadow.enabled !== false)
    .forEach((shadow) => {
      const reach = (shadow.blur || 0) + (shadow.spread || 0);
      extend(reach - shadow.x, reach - shadow.y, reach + shadow.x, reach + shadow.y);
    });
  (style.borders || [])
    .filter((border) => border.enabled !== false)
    .forEach((border) => {
      const position = enumKey(Style.BorderPosition, border.position);
      const reach =
        position === "Outside" ? border.thickness : position === "Center" ? border.thickness / 2 : 0;
      extend(reach, reach, reach, reach);
    });

  const extraWidth = previewSize.width / PREVIEW_SCALE - layer.frame.width;
  const extraHeight = previewSize.height / PREVIEW_SCALE - layer.frame.height;
  const x = Math.abs(outset.left + outset.right - extraWidth) <= 1 ? outset.left : extraWidth / 2;
  const y = Math.abs(outset.top + outset.bottom - extraHeight) <= 1 ? outset.top : extraHeight / 2;
  return { x: round(x), y: round(y) };
}

// Width and height live at bytes 16..23 of the PNG IHDR chunk.
function pngSize(buffer) {
  try {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch (e) {
    return undefined;
  }
}
