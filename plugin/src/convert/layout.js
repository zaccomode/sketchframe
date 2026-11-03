import * as dom from "sketch/dom";
import { enumKey, camel } from "../utils/enums";
import { round, clean } from "../utils/math";

const JUSTIFY = {
  Start: "flex-start",
  Center: "center",
  End: "flex-end",
  Between: "space-between",
  Around: "space-around",
  Evenly: "space-evenly",
};

const ALIGN = {
  Start: "flex-start",
  Center: "center",
  End: "flex-end",
  Stretch: "stretch",
};

const SIZING = {
  Fixed: "fixed",
  Fit: "hug",
  Fill: "fill",
  Relative: "relative",
};

// Sketch stack layouts map almost one-to-one onto CSS flexbox.
export function convertStackLayout(stack) {
  if (!stack) return undefined;
  const StackLayout = dom.StackLayout || {};
  const direction = enumKey(StackLayout.Direction, stack.direction);
  const wraps = Boolean(stack.wraps || stack.wrap);

  return clean({
    mode: String(direction).toLowerCase() === "column" ? "column" : "row",
    justifyContent: JUSTIFY[enumKey(StackLayout.JustifyContent, stack.justifyContent)],
    alignItems: ALIGN[enumKey(StackLayout.AlignItems, stack.alignItems)],
    gap: stack.gap ? round(stack.gap) : undefined,
    padding: paddingCss(stack.padding),
    wrap: wraps || undefined,
    alignContent: wraps
      ? JUSTIFY[enumKey(StackLayout.JustifyContent, stack.alignContent)]
      : undefined,
    crossAxisGap: wraps && stack.crossAxisGap ? round(stack.crossAxisGap) : undefined,
    stackingOrder:
      enumKey(StackLayout.StackingOrder, stack.stackingOrder) === "FirstOnTop"
        ? "firstOnTop"
        : undefined,
    bordersAffectLayout: stack.bordersAffectLayout || undefined,
  });
}

function paddingCss(padding) {
  if (padding === undefined || padding === null) return undefined;
  if (typeof padding === "number") return padding ? `${round(padding)}px` : undefined;
  const top = padding.top || 0;
  const right = padding.right || 0;
  const bottom = padding.bottom || 0;
  const left = padding.left || 0;
  if (!top && !right && !bottom && !left) return undefined;
  const px = (n) => `${round(n)}px`;
  if (top === bottom && left === right) {
    return top === left ? px(top) : `${px(top)} ${px(right)}`;
  }
  return `${px(top)} ${px(right)} ${px(bottom)} ${px(left)}`;
}

export function convertSizing(layer, inStack) {
  const out = {};
  const horizontal = sizingKey(layer.horizontalSizing);
  const vertical = sizingKey(layer.verticalSizing);
  if (
    (horizontal || vertical) &&
    (inStack || horizontal !== "fixed" || vertical !== "fixed")
  ) {
    out.sizing = clean({ horizontal, vertical });
  }
  if (layer.minSize) out.minSize = size(layer.minSize);
  if (layer.maxSize) out.maxSize = size(layer.maxSize);
  if (layer.percentageSize) out.percentageSize = size(layer.percentageSize, 4);
  return out;
}

function sizingKey(value) {
  if (value === undefined || value === null) return undefined;
  const key = enumKey(dom.FlexSizing, value);
  return SIZING[key] || String(key).toLowerCase();
}

function size(value, precision) {
  return clean({
    width: round(value.width, precision),
    height: round(value.height, precision),
  });
}

// Resizing constraints, only meaningful for layers outside stack flow.
export function convertConstraints(layer) {
  const Pin = dom.Pin || (dom.Layer && dom.Layer.Pin);
  if (!Pin || typeof layer.horizontalPins !== "number") return undefined;
  return {
    horizontal: pinsToString(layer.horizontalPins, Pin, "left", "right"),
    vertical: pinsToString(layer.verticalPins, Pin, "top", "bottom"),
  };
}

function pinsToString(mask, Pin, min, max) {
  const hasMin = (mask & Pin.Min) !== 0;
  const hasMax = (mask & Pin.Max) !== 0;
  if (hasMin && hasMax) return `${min}-${max}`;
  if (hasMin) return min;
  if (hasMax) return max;
  return "scale";
}

// Sketch's rotation already follows the CSS convention (clockwise positive),
// applied around the centre of the layer's unrotated frame.
export function convertTransform(layer) {
  const transform = layer.transform;
  if (!transform) return {};
  return clean({
    rotation: transform.rotation ? round(transform.rotation, 2) : undefined,
    flipX: transform.flippedHorizontally || undefined,
    flipY: transform.flippedVertically || undefined,
  });
}

export function convertCorners(layer) {
  const corners = layer.style && layer.style.corners;
  let radii;
  let style;
  let smoothing;
  let concentric;

  if (corners && corners.hasRadii !== false && corners.radii !== undefined) {
    radii = corners.radii;
    style = camel(enumKey(dom.Style && dom.Style.CornerStyle, corners.style));
    smoothing = corners.smoothing;
    concentric = corners.concentric;
  } else if (layer.points && layer.points.length === 4) {
    radii = layer.points.map((point) => point.cornerRadius || 0);
  }

  const radius = normaliseRadii(radii);
  if (radius === undefined) return undefined;

  return clean({
    radius,
    style: style && style !== "auto" && style !== "rounded" ? style : undefined,
    smoothing: style === "smooth" ? round(smoothing, 3) : undefined,
    concentric: concentric || undefined,
  });
}

// Returns a single number when all corners match, otherwise
// [topLeft, topRight, bottomRight, bottomLeft] like CSS border-radius.
function normaliseRadii(radii) {
  if (radii === undefined || radii === null) return undefined;
  const list = (Array.isArray(radii) ? radii : [radii]).map((r) => round(r || 0));
  if (list.every((r) => r === 0)) return undefined;
  if (list.every((r) => r === list[0])) return list[0];
  return list;
}
