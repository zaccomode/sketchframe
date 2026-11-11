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
    // Vector nodes whose SVG Sketch couldn't export, as { id, name }.
    missingAssets: [],
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
  const scratch = createScratch();

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

    // Vector layers and icon groups are rendered by Sketch as SVG. Returns
    // undefined if Sketch couldn't export the layer; the caller records it.
    addSvg(layer) {
      const svg = exportSvg(layer, scratch);
      if (svg == null) return undefined;
      const path = `assets/vec_${hash(svg)}.svg`;
      if (!files[path]) files[path] = svg;
      return path;
    },

    // Removes anything the export added to the document. Call once, when the
    // export is finished (including when it fails).
    dispose() {
      scratch.dispose();
    },
  };
}

function exportSvgData(layer) {
  let data = sketch.export(layer, { formats: ["svg"], output: false });
  if (Array.isArray(data)) data = data[0];
  return String(data);
}

// Layers from an instance's expandedLayers (e.g. a nested component inside the
// exported one) aren't attached to a page, and sketch.export needs a page to
// find the document. Those are exported from a copy placed in the export's
// scratch group on the current page. Copies stay there until the export ends
// and the whole group is removed.
function exportSvg(layer, scratch) {
  let directError;
  try {
    return exportSvgData(layer);
  } catch (e) {
    // Expected for layers that aren't on a page; only logged if the copy fails too.
    directError = e;
  }

  try {
    const copy = sketch.fromNative(layer.sketchObject.copy());
    if (!scratch.add(copy)) {
      console.error(`sketchframe: couldn't export vector “${layer.name}” as SVG (no page)`, directError);
      return undefined;
    }
    return exportSvgData(copy);
  } catch (e) {
    console.error(`sketchframe: couldn't export vector “${layer.name}” as SVG`, directError, e);
    return undefined;
  }
}

// Cleanup runs in `finally` blocks, where a throw would replace the export's
// result (or its real error), so failures here are only logged. remove() is
// called unconditionally: asking a layer for its parent (the wrapper's
// `parent`, or the native `parentGroup()`) isn't reliable here.
function removeQuietly(layer) {
  try {
    layer.remove();
  } catch (e) {
    console.error("sketchframe: couldn't remove a temporary layer", e);
  }
}

// Removes every scratch group on `page`, including any left behind by an
// export that was interrupted (crash, force-quit).
function sweep(page) {
  try {
    page.layers.filter((layer) => layer.name === SCRATCH_NAME).forEach(removeQuietly);
  } catch (e) {
    console.error("sketchframe: couldn't look for temporary groups", e);
  }
}

const SCRATCH_NAME = "sketchframe-tmp";
// NSDocument's NSChangeCleared: marks the document as having no unsaved changes.
const NSChangeCleared = 2;

// One temporary group per export, on the current page, that layers which
// aren't on a page are copied into so Sketch can export them. An export should
// leave the document as it found it, so while the group exists undo
// registration is disabled (the inserts and removals don't land on the undo
// stack, and ⌘Z after an export still undoes the user's last edit), and if the
// document had no unsaved changes beforehand it is marked clean again once the
// group is removed. Created only when first needed: most exports never use it.
//
// The group's state is tracked here rather than read back from Sketch, and
// disposing sweeps the page for the group by name as well, so nothing is left
// behind even if a reference to the group goes stale.
function createScratch() {
  let page;
  let group;
  let session;

  const open = (layer) => {
    const document = sketch.getSelectedDocument();
    page = document && document.selectedPage;
    if (!page) return false;
    if (!session) {
      session = beginUntrackedChanges(document);
      sweep(page);
    }
    group = new sketch.Group({ name: SCRATCH_NAME, parent: page, layers: [layer] });
    return true;
  };

  return {
    // Puts `layer` into the scratch group. Returns false if there is no page.
    add(layer) {
      if (group) {
        try {
          layer.parent = group;
          return true;
        } catch (e) {
          // Fall back to a new group; both are removed by dispose().
          console.error("sketchframe: couldn't reuse the temporary group", e);
        }
      }
      return open(layer);
    },

    dispose() {
      if (group) removeQuietly(group);
      if (page) sweep(page);
      page = undefined;
      group = undefined;
      if (session) session.end();
      session = undefined;
    },
  };
}

// Disables undo registration on the document and remembers whether it had
// unsaved changes. `end()` restores both. Every native call is guarded so an
// API Sketch no longer has doesn't break the export.
function beginUntrackedChanges(document) {
  const native = document.sketchObject;
  const undoManager =
    native && typeof native.undoManager === "function" ? native.undoManager() : null;
  const wasEdited =
    native && typeof native.isDocumentEdited === "function" ? Boolean(native.isDocumentEdited()) : true;

  try {
    if (undoManager) undoManager.disableUndoRegistration();
  } catch (e) {
    console.error("sketchframe: couldn't pause undo registration", e);
  }

  return {
    end() {
      // Sketch 2026.2+ batches layer changes and marks the document as edited
      // when it processes them, so they're flushed first: while undo
      // registration is still off, and before the edited state is restored.
      try {
        if (typeof document.processPendingChanges === "function") document.processPendingChanges();
      } catch (e) {
        console.error("sketchframe: couldn't process pending changes", e);
      }
      try {
        if (undoManager) undoManager.enableUndoRegistration();
      } catch (e) {
        console.error("sketchframe: couldn't resume undo registration", e);
      }
      try {
        if (!wasEdited && native.isDocumentEdited()) native.updateChangeCount(NSChangeCleared);
      } catch (e) {
        console.error("sketchframe: couldn't restore the document's edited state", e);
      }
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
