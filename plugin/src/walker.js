import sketch from "sketch";
import * as dom from "sketch/dom";
import { cssColor } from "./utils/color";
import { enumKey } from "./utils/enums";
import { hash } from "./utils/hash";
import { round, clean, isEmpty } from "./utils/math";
import { convertFills, convertBorders, convertBorderOptions, blendMode } from "./convert/paint";
import { convertEffects } from "./convert/effects";
import { convertText } from "./convert/text";
import {
  convertStackLayout,
  convertSizing,
  convertConstraints,
  convertTransform,
  convertCorners,
} from "./convert/layout";

const SKIPPED_TYPES = ["Slice", "HotSpot"];
const CONTAINER_TYPES = ["frame", "graphic", "group", "instance"];
const CORNER_TYPES = ["frame", "graphic", "group", "rectangle", "image", "instance"];

// Converts a Sketch layer (and its descendants) into a design-tree node.
// `parent` is null for the exported root.
export function walk(layer, ctx, parent) {
  if (layer.hidden || SKIPPED_TYPES.includes(layer.type)) return null;

  let type = nodeType(layer);
  if (!type) return null;
  if ((type === "group" || type === "graphic") && isVectorOnly(layer)) type = "vector";

  const isRoot = !parent;
  const frame = layer.frame;
  // `sketchId` is a short, stable hash of the Sketch layer ID, so annotations
  // can be re-attached after a re-export renumbers the `n…` ids.
  const node = { id: ctx.nextId(), sketchId: hash(String(layer.id)), name: layer.name, type };
  if (!isRoot) {
    node.x = round(frame.x);
    node.y = round(frame.y);
  }
  node.width = round(frame.width);
  node.height = round(frame.height);
  Object.assign(node, convertTransform(layer));

  const inStack = Boolean(parent && parent.isStack);
  const inFlow = inStack && !layer.ignoresStackLayout;
  if (inStack && !inFlow) node.position = "absolute";
  if (!isRoot) {
    Object.assign(node, convertSizing(layer, inStack));
    if (!inFlow) {
      const constraints = convertConstraints(layer);
      if (constraints) node.constraints = constraints;
    }
  }

  // Instances take their appearance from the symbol, with overrides applied.
  const styleSource = type === "instance" ? instanceStyleSource(layer) : layer;
  if (styleSource.sharedStyle && styleSource.sharedStyle.name) {
    node.sharedStyle = styleSource.sharedStyle.name;
  }
  Object.assign(node, convertStyle(styleSource, type, ctx, frame));

  if (type === "text") Object.assign(node, convertText(layer, ctx));
  if (type === "image") node.src = ctx.assets.addImageData(layer.image);
  if (type === "vector") {
    node.src = ctx.assets.addSvg(layer);
    if (!node.src) ctx.missingAssets.push({ id: node.id, name: node.name });
  }
  if (type === "instance" && layer.master) {
    node.component = layer.master.name;
    node.componentId = registerComponent(layer.master, ctx);
    if (styleSource === layer.master) applyRootColorOverrides(node, layer);
    const overrides = convertOverrides(layer, ctx);
    if (overrides.length) node.overrides = overrides;
  }

  if (CONTAINER_TYPES.includes(type)) {
    const stack = stackLayoutOf(layer);
    const layout = convertStackLayout(stack);
    if (layout) node.layout = layout;
    if (layer.clipsContents || styleSource.clipsContents || layer.type === "Artboard") {
      node.clipContent = true;
    }

    const children = orderChildren(childLayersOf(layer), stack)
      .map((child) => walk(child, ctx, { isStack: Boolean(stack) }))
      .filter(Boolean);
    if (children.length) node.children = children;
  }

  return node;
}

function nodeType(layer) {
  switch (layer.type) {
    case "Artboard":
    case "SymbolMaster":
      return "frame";
    case "Group":
      if (layer.isGraphicFrame) return "graphic";
      if (layer.isFrame) return "frame";
      return "group";
    case "Text":
      return "text";
    case "Image":
      return "image";
    case "SymbolInstance":
      return "instance";
    case "Shape":
      return "vector";
    case "ShapePath": {
      const shapeType = enumKey(dom.ShapePath && dom.ShapePath.ShapeType, layer.shapeType);
      if (!layer.edited && shapeType === "Rectangle") return "rectangle";
      if (!layer.edited && shapeType === "Oval") return "oval";
      return "vector";
    }
    default:
      return undefined;
  }
}

// Groups made only of shapes (icons, illustrations) are exported as a single
// SVG instead of a tree of paths.
function isVectorOnly(group) {
  if (group.stackLayout || (group.isFrame && !group.isGraphicFrame)) return false;
  const visible = (group.layers || []).filter((child) => !child.hidden);
  if (!visible.length) return false;
  return visible.every((child) => {
    if (child.type === "ShapePath" || child.type === "Shape") return true;
    if (child.type === "Group") return isVectorOnly(child);
    return false;
  });
}

// `frame` is the layer's own frame; for instances `layer` is the symbol (or
// its resolved copy), whose size can differ.
function convertStyle(layer, type, ctx, frame) {
  const style = layer.style;
  const out = {};
  if (!style) return out;

  if (typeof style.opacity === "number" && style.opacity < 1) out.opacity = round(style.opacity, 3);
  const blend = blendMode(style.blendingMode);
  if (blend) out.blendMode = blend;

  // Vectors carry their own paint in the SVG; images and text keep fills
  // because Sketch can tint them.
  if (type !== "vector") {
    const size = { width: frame.width, height: frame.height };
    const fills = convertFills(style.fills, size, ctx);
    // Frames also report their bottom fill as `background`, so it's only
    // used for legacy artboards that have no fills.
    const background = fills.length ? undefined : artboardBackground(layer);
    if (background) fills.push(background);
    if (fills.length) out.fills = fills;

    const borders = convertBorders(style.borders, size, ctx);
    if (borders.length) {
      out.borders = borders;
      const options = convertBorderOptions(style.borderOptions);
      if (!isEmpty(options)) out.borderOptions = options;
    }
  }

  if (CORNER_TYPES.includes(type)) {
    const corners = convertCorners(layer);
    if (corners) out.corners = corners;
  }

  const effects = convertEffects(style, type === "text", ctx);
  if (!isEmpty(effects)) out.effects = effects;

  return out;
}

function artboardBackground(layer) {
  const background = layer.background;
  if (!background || !background.enabled || !background.color) return undefined;
  return { type: "solid", color: cssColor(background.color) };
}

// The instance layer itself has no fills or borders. Sketch keeps a detached
// copy of each instance with overrides applied, which has the symbol's style;
// failing that, the master's style is used and root color overrides are
// applied by hand.
function instanceStyleSource(instance) {
  try {
    const native = instance.sketchObject;
    native.sketchapiEnsureDetachHasUpdated();
    const detached = native.detachedInstance();
    if (detached) {
      const resolved = sketch.fromNative(detached);
      if (resolved && resolved.style && resolved.style.fills && resolved.style.fills.length) {
        return resolved;
      }
    }
  } catch (e) {
    // Fall through to the master.
  }
  return instance.master || instance;
}

// Color overrides on the symbol's own fills, e.g. property "color:fill-0".
// Sketch numbers fills bottom-first; node fills are top-first.
function applyRootColorOverrides(node, instance) {
  if (!Array.isArray(node.fills)) return;
  const masterId = instance.master && instance.master.id;
  (instance.overrides || []).forEach((override) => {
    if (override.isDefault || !override.colorOverride) return;
    const affected = override.affectedLayer;
    if (affected && affected.id !== masterId) return;
    const match = /fill-(\d+)/.exec(override.property);
    if (!match) return;
    const fill = node.fills[node.fills.length - 1 - Number(match[1])];
    const color = cssColor(String(override.value));
    if (fill && fill.type === "solid" && color) {
      node.fills[node.fills.length - 1 - Number(match[1])] = { ...fill, color, token: undefined };
    }
  });
}

// Non-default overrides, so an agent can see what differs from the symbol.
function convertOverrides(instance, ctx) {
  return (instance.overrides || [])
    .filter((override) => !override.isDefault)
    .map((override) =>
      clean({
        layer: override.affectedLayer ? override.affectedLayer.name : undefined,
        property: override.property,
        value: overrideValue(override, ctx),
      }),
    );
}

function overrideValue(override, ctx) {
  const value = override.value;
  if (override.property === "image") return value ? ctx.assets.addImageData(value) : undefined;
  if (override.colorOverride) return cssColor(String(value)) || String(value);
  return value;
}

// Each symbol used in the frame is exported once under `components`, keyed by
// symbol ID. Masters are queued here and walked after the frame (see
// `walkComponents`) so the frame's node IDs stay sequential.
function registerComponent(master, ctx) {
  const key = String(master.symbolId || master.id);
  if (!(key in ctx.components)) {
    ctx.components[key] = null;
    ctx.pendingMasters.push({ key, master });
  }
  return key;
}

// Walks queued masters, including symbols nested inside other symbols.
export function walkComponents(ctx) {
  while (ctx.pendingMasters.length) {
    const { key, master } = ctx.pendingMasters.shift();
    ctx.components[key] = clean({
      name: master.name,
      library: libraryName(master),
      root: walk(master, ctx, null),
    });
  }
  return ctx.components;
}

function libraryName(master) {
  try {
    const library = master.getLibrary && master.getLibrary();
    return library && library.name ? String(library.name) : undefined;
  } catch (e) {
    return undefined;
  }
}

function stackLayoutOf(layer) {
  if (layer.stackLayout) return layer.stackLayout;
  if (layer.type === "SymbolInstance" && layer.master) return layer.master.stackLayout || null;
  return null;
}

// Symbol instances are walked through their resolved (overridden) contents.
function childLayersOf(layer) {
  if (layer.type !== "SymbolInstance") return layer.layers || [];
  let expanded = layer.expandedLayers;
  if (expanded && !Array.isArray(expanded)) expanded = expanded.layers;
  if (expanded && expanded.length) return expanded;
  return (layer.master && layer.master.layers) || [];
}

// Children are emitted back-to-front (DOM order). Inside stacks, in-flow
// children are ordered by their position along the main axis instead.
function orderChildren(layers, stack) {
  if (!stack) return layers.slice();
  const column =
    String(enumKey(dom.StackLayout && dom.StackLayout.Direction, stack.direction)).toLowerCase() ===
    "column";
  const inFlow = layers.filter((l) => !l.ignoresStackLayout);
  const absolute = layers.filter((l) => l.ignoresStackLayout);
  inFlow.sort((a, b) => (column ? a.frame.y - b.frame.y : a.frame.x - b.frame.x));
  return inFlow.concat(absolute);
}
