import sketch from "sketch";
import { Buffer } from "buffer";
import { cssColor } from "./utils/color";
import { hash } from "./utils/hash";

// Shared state for one export: node ids, referenced tokens, symbols used,
// collected asset files, and per-range text attributes read from the
// file-format JSON.
export function createContext(rootLayer) {
  let lastId = 0;
  const colorTokens = {};
  const attributedStrings = indexAttributedStrings(rootLayer);

  return {
    assets: createAssetStore(),
    colorTokens,
    components: {},
    pendingMasters: [],

    nextId() {
      lastId += 1;
      return `n${lastId}`;
    },

    // Records a swatch (color variable) and returns its name for use as a token.
    useSwatch(swatch) {
      if (!swatch || !swatch.name) return undefined;
      colorTokens[swatch.name] = cssColor(swatch.color);
      return swatch.name;
    },

    attributedStringFor(layer) {
      return attributedStrings[layer.id];
    },
  };
}

function createAssetStore() {
  const files = {};

  return {
    files,

    // Image fills and image layers. The original bytes are kept, so the file
    // extension follows the source format.
    addImageData(imageData) {
      const base64 = imageData && String(imageData.base64 || "");
      if (!base64) return undefined;
      const path = `assets/img_${hash(base64)}.${imageExtension(base64)}`;
      if (!files[path]) files[path] = Buffer.from(base64, "base64");
      return path;
    },

    // Vector layers and icon groups are rendered by Sketch as SVG.
    addSvg(layer) {
      let data = sketch.export(layer, { formats: ["svg"], output: false });
      if (Array.isArray(data)) data = data[0];
      const svg = String(data);
      const path = `assets/vec_${hash(svg)}.svg`;
      if (!files[path]) files[path] = svg;
      return path;
    },
  };
}

function imageExtension(base64) {
  if (base64.startsWith("iVBOR")) return "png";
  if (base64.startsWith("/9j/")) return "jpg";
  if (base64.startsWith("R0lG")) return "gif";
  if (base64.startsWith("UklG")) return "webp";
  if (base64.startsWith("SUkq") || base64.startsWith("TU0A")) return "tiff";
  return "bin";
}

// Exporting the root once as file-format JSON is much faster than exporting
// every text layer separately. Layers that aren't found here (e.g. expanded
// symbol contents) fall back to a per-layer export.
function indexAttributedStrings(rootLayer) {
  const index = {};
  let data;
  try {
    data = sketch.export(rootLayer, { formats: ["json"], output: false });
    if (Array.isArray(data)) data = data[0];
    if (data && !data.do_objectID && typeof data.toString === "function") {
      data = JSON.parse(String(data));
    }
  } catch (e) {
    return index;
  }

  const visit = (object) => {
    if (!object || typeof object !== "object") return;
    if (object.do_objectID && object.attributedString) {
      index[object.do_objectID] = object.attributedString;
    }
    (object.layers || []).forEach(visit);
  };
  visit(data);
  return index;
}
