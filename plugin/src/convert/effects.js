import { Style } from "sketch/dom";
import { cssColor } from "../utils/color";
import { enumKey } from "../utils/enums";
import { round, clean } from "../utils/math";
import { blendMode } from "./paint";

export function convertEffects(style, isText, ctx) {
  const shadows = []
    .concat(
      (style.shadows || []).map((s) => convertShadow(s, false, ctx)),
      (style.innerShadows || []).map((s) => convertShadow(s, true, ctx)),
    )
    .filter(Boolean);

  const blurs = (style.blurs || (style.blur ? [style.blur] : []))
    .filter((blur) => blur && blur.enabled)
    .map(convertBlur);

  const css = {};
  if (shadows.length) {
    if (isText) {
      css.textShadow = shadows
        .filter((s) => !s.inset)
        .map((s) => `${s.x}px ${s.y}px ${s.blur}px ${s.color}`)
        .join(", ");
    } else {
      css.boxShadow = shadows
        .map(
          (s) =>
            `${s.inset ? "inset " : ""}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${s.color}`,
        )
        .join(", ");
    }
  }
  blurs.forEach((blur) => {
    if (blur.filter) css.filter = blur.filter;
    if (blur.backdropFilter) css.backdropFilter = blur.backdropFilter;
  });

  const progressiveAlpha = style.progressiveAlpha
    ? { from: style.progressiveAlpha.from, to: style.progressiveAlpha.to, stops: style.progressiveAlpha.stops }
    : undefined;

  return clean({ shadows, blurs, progressiveAlpha, css: clean(css) });
}

function convertShadow(shadow, inset, ctx) {
  if (!shadow || shadow.enabled === false) return null;
  return clean({
    inset: inset || undefined,
    x: round(shadow.x),
    y: round(shadow.y),
    blur: round(shadow.blur),
    spread: round(shadow.spread || 0),
    color: cssColor(shadow.color),
    token: ctx.useSwatch(shadow.swatch),
    blendMode: blendMode(shadow.blendingMode),
  });
}

// `radius` is Sketch's own blur radius; the css fields are the closest CSS
// equivalent and should be checked against the preview.
function convertBlur(blur) {
  const type = (enumKey(Style.BlurType, blur.blurType) || "Gaussian").toLowerCase();
  const radius = round(blur.radius);
  const out = { type, radius };

  if (type === "gaussian") {
    out.filter = `blur(${radius}px)`;
  } else if (type === "background") {
    const saturation = typeof blur.saturation === "number" ? blur.saturation : 1;
    out.backdropFilter =
      `blur(${radius}px)` + (saturation !== 1 ? ` saturate(${round(saturation, 3)})` : "");
  } else if (type === "glass") {
    Object.assign(out, {
      brightness: round(blur.brightness, 3),
      distortion: round(blur.distortion, 3),
      depth: round(blur.depth, 3),
      chromaticAberration: round(blur.chromaticAberration, 3),
      saturation: round(blur.saturation, 3),
      specularHighlights: blur.hasSpecularHighlights || undefined,
    });
    out.backdropFilter = `blur(${radius}px)`;
  } else if (type === "motion") {
    out.angle = round(blur.motionAngle);
  } else if (type === "zoom" && blur.center) {
    out.center = { x: round(blur.center.x, 4), y: round(blur.center.y, 4) };
  }

  if (blur.progressive && blur.gradient) {
    out.progressive = {
      from: blur.gradient.from,
      to: blur.gradient.to,
      stops: (blur.gradient.stops || []).map((s) => ({
        position: round(s.position, 4),
        alpha: round(typeof s.alpha === "number" ? s.alpha : 1, 3),
      })),
    };
  }
  return clean(out);
}
