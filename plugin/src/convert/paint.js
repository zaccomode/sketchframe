import { Style } from "sketch/dom";
import { cssColor } from "../utils/color";
import { enumKey, kebab } from "../utils/enums";
import { round, degrees, clean } from "../utils/math";

const PATTERN_FIT = {
  Fill: "cover",
  Fit: "contain",
  Stretch: "stretch",
  Tile: "tile",
};

export function blendMode(value) {
  const key = enumKey(Style.BlendingMode, value);
  if (!key || key === "Normal") return undefined;
  return kebab(key);
}

// Fills are returned top-most first, matching CSS background layer order.
export function convertFills(fills, size, ctx) {
  return (fills || [])
    .filter((fill) => fill.enabled !== false)
    .map((fill) => convertPaint(fill, size, ctx))
    .filter(Boolean)
    .reverse();
}

export function convertBorders(borders, size, ctx) {
  return (borders || [])
    .filter((border) => border.enabled !== false && border.thickness > 0)
    .map((border) => {
      const paint = convertPaint(border, size, ctx);
      if (!paint) return null;
      const sides =
        border.hasIndividualSides && border.sides
          ? {
              top: border.sides.top,
              right: border.sides.right,
              bottom: border.sides.bottom,
              left: border.sides.left,
            }
          : undefined;
      return clean({
        position: (
          enumKey(Style.BorderPosition, border.position) || "center"
        ).toLowerCase(),
        thickness: round(border.thickness),
        sides,
        ...paint,
      });
    })
    .filter(Boolean)
    .reverse();
}

export function convertBorderOptions(options) {
  if (!options) return undefined;
  const dash = options.dashPattern || [];
  return clean({
    dashPattern: dash.length ? dash.map((n) => round(n)) : undefined,
    lineCap: lowerKey(options.lineEnd, "Butt"),
    lineJoin: lowerKey(options.lineJoin, "Miter"),
    startArrowhead: lowerKey(options.startArrowhead, "None"),
    endArrowhead: lowerKey(options.endArrowhead, "None"),
  });
}

function lowerKey(value, defaultKey) {
  if (value === undefined || value === null) return undefined;
  const key = String(value);
  if (key.toLowerCase() === defaultKey.toLowerCase()) return undefined;
  return key.charAt(0).toLowerCase() + key.slice(1);
}

function convertPaint(paint, size, ctx) {
  const type = enumKey(Style.FillType, paint.fillType);
  const blend = blendMode(paint.blendingMode);

  if (type === "Gradient" && paint.gradient) {
    return clean({ ...convertGradient(paint.gradient, size, ctx), blendMode: blend });
  }

  if (type === "Pattern" && paint.pattern) {
    const image = paint.pattern.image;
    if (!image) return null;
    const fit = PATTERN_FIT[enumKey(Style.PatternFillType, paint.pattern.patternType)];
    return clean({
      type: "image",
      src: ctx.assets.addImageData(image),
      fit: fit || "cover",
      tileScale: fit === "tile" ? round(paint.pattern.tileScale, 3) : undefined,
      blendMode: blend,
    });
  }

  return clean({
    type: "solid",
    color: cssColor(paint.color),
    token: ctx.useSwatch(paint.swatch),
    blendMode: blend,
  });
}

export function convertGradient(gradient, size, ctx) {
  const kind = (enumKey(Style.GradientType, gradient.gradientType) || "Linear").toLowerCase();
  const stops = (gradient.stops || []).map((stop) =>
    clean({
      position: round(stop.position, 4),
      color: cssColor(stop.color),
      token: ctx.useSwatch(stop.swatch),
    }),
  );
  const from = { x: round(gradient.from.x, 4), y: round(gradient.from.y, 4) };
  const to = { x: round(gradient.to.x, 4), y: round(gradient.to.y, 4) };

  let css;
  let approximate;
  if (kind === "radial") {
    ({ css, approximate } = radialCss(gradient, size, stops));
  } else if (kind === "angular") {
    css = `conic-gradient(from 90deg at 50% 50%, ${stops
      .map((s) => `${s.color} ${round(s.position * 100)}%`)
      .join(", ")})`;
    approximate = true;
  } else {
    css = linearCss(gradient, size, stops);
  }

  return clean({
    type: kind,
    css,
    approximate,
    from,
    to,
    aspectRatio:
      kind === "radial" && gradient.aspectRatio && gradient.aspectRatio !== 1
        ? round(gradient.aspectRatio, 4)
        : undefined,
    stops,
  });
}

// Sketch gradients run between two arbitrary points in the layer's unit box.
// CSS linear gradients run along a line through the box centre whose length
// depends on the angle, so stop positions are re-projected onto that line to
// get an exact match.
function linearCss(gradient, size, stops) {
  const w = size.width || 1;
  const h = size.height || 1;
  const fx = gradient.from.x * w;
  const fy = gradient.from.y * h;
  const dx = gradient.to.x * w - fx;
  const dy = gradient.to.y * h - fy;

  const angle = Math.atan2(dx, -dy); // CSS: 0deg points up, clockwise
  const ux = Math.sin(angle);
  const uy = -Math.cos(angle);
  const length = Math.abs(w * ux) + Math.abs(h * uy) || 1;
  const sx = w / 2 - (ux * length) / 2;
  const sy = h / 2 - (uy * length) / 2;

  const cssStops = stops.map((stop) => {
    const px = fx + dx * stop.position;
    const py = fy + dy * stop.position;
    const t = ((px - sx) * ux + (py - sy) * uy) / length;
    return `${stop.color} ${round(t * 100)}%`;
  });
  return `linear-gradient(${round(degrees(angle))}deg, ${cssStops.join(", ")})`;
}

function radialCss(gradient, size, stops) {
  const cx = gradient.from.x * size.width;
  const cy = gradient.from.y * size.height;
  const radius = Math.hypot(
    (gradient.to.x - gradient.from.x) * size.width,
    (gradient.to.y - gradient.from.y) * size.height,
  );
  const cssStops = stops
    .map((s) => `${s.color} ${round(s.position * 100)}%`)
    .join(", ");
  const ratio = gradient.aspectRatio;
  if (!ratio || ratio === 1) {
    return {
      css: `radial-gradient(circle ${round(radius)}px at ${round(cx)}px ${round(cy)}px, ${cssStops})`,
    };
  }
  // Elliptical Sketch gradients can also be rotated, which CSS can't express.
  return {
    css: `radial-gradient(ellipse ${round(radius)}px ${round(radius * ratio)}px at ${round(cx)}px ${round(cy)}px, ${cssStops})`,
    approximate: true,
  };
}
