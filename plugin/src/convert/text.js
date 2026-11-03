import sketch from "sketch";
import { cssColor, cssColorFromComponents } from "../utils/color";
import { round, clean } from "../utils/math";

// Sketch's 0..12 font weight scale (AppKit-style) to CSS weights. The exact
// face is given by `fontName` when available, so this is a best-effort hint.
const CSS_WEIGHTS = [100, 100, 100, 200, 300, 400, 500, 600, 600, 700, 800, 900, 900];

export function convertText(layer, ctx) {
  const style = layer.style;
  const textStyle = clean({
    fontFamily: style.fontFamily,
    fontWeight: CSS_WEIGHTS[style.fontWeight],
    sketchFontWeight: style.fontWeight,
    fontStyle: style.fontStyle || undefined,
    fontVariant: style.fontVariant || undefined,
    fontStretch: style.fontStretch || undefined,
    fontSize: round(style.fontSize),
    lineHeight: lineHeight(style),
    lineHeightAuto: style.lineHeight === null || style.lineHeight === undefined || undefined,
    letterSpacing: style.kerning ? round(style.kerning, 3) : undefined,
    paragraphSpacing: style.paragraphSpacing ? round(style.paragraphSpacing) : undefined,
    textTransform:
      style.textTransform && style.textTransform !== "none" ? style.textTransform : undefined,
    textAlign: style.alignment || undefined,
    verticalAlign:
      style.verticalAlignment && style.verticalAlignment !== "top"
        ? style.verticalAlignment
        : undefined,
    color: cssColor(style.textColor),
    colorToken: ctx.useSwatch(style.textSwatch),
    textDecoration: textDecoration(style.textUnderline, style.textStrikethrough),
  });

  const runs = attributedRuns(layer, textStyle, ctx);
  if (runs.fontName) textStyle.fontName = runs.fontName;

  return clean({
    text: layer.text,
    textBehaviour: layer.fixedWidth ? "fixed-width" : "auto-width",
    textStyle,
    textRuns: runs.list,
  });
}

function lineHeight(style) {
  if (typeof style.lineHeight === "number") return round(style.lineHeight);
  if (typeof style.getDefaultLineHeight === "function") {
    return round(style.getDefaultLineHeight());
  }
  return undefined;
}

function textDecoration(underline, strikethrough) {
  const parts = [];
  if (underline) parts.push("underline");
  if (strikethrough) parts.push("line-through");
  return parts.length ? parts.join(" ") : undefined;
}

// The JS API only exposes whole-layer text styles, so per-range formatting is
// read from the Sketch file-format JSON (`attributedString.attributes`).
// Only properties that differ from the layer's base style are kept per run.
function attributedRuns(layer, base, ctx) {
  const attributed = ctx.attributedStringFor(layer) || exportAttributedString(layer);
  if (!attributed || !attributed.attributes || !attributed.attributes.length) return {};

  const runs = attributed.attributes.map((range) => runStyle(attributed.string, range));
  const fontNames = runs.map((run) => run.fontName).filter(Boolean);
  const fontName = mostCommon(fontNames);
  if (runs.length < 2) return { fontName };

  const list = runs.map((run) =>
    clean({
      text: run.text,
      fontName: run.fontName !== fontName ? run.fontName : undefined,
      fontSize: run.fontSize !== base.fontSize ? run.fontSize : undefined,
      color: run.color !== base.color ? run.color : undefined,
      letterSpacing:
        run.letterSpacing !== undefined && run.letterSpacing !== (base.letterSpacing || 0)
          ? run.letterSpacing
          : undefined,
      textDecoration: run.textDecoration !== base.textDecoration ? run.textDecoration : undefined,
    }),
  );
  const hasOverrides = list.some((run) => Object.keys(run).length > 1);
  return { fontName, list: hasOverrides ? list : undefined };
}

function runStyle(string, range) {
  const attributes = range.attributes || {};
  const font = attributes.MSAttributedStringFontAttribute;
  const fontAttributes = (font && font.attributes) || {};
  return {
    text: String(string || "").substr(range.location, range.length),
    fontName: fontAttributes.name,
    fontSize: round(fontAttributes.size),
    color: cssColorFromComponents(attributes.MSAttributedStringColorAttribute),
    letterSpacing: typeof attributes.kerning === "number" ? round(attributes.kerning, 3) : undefined,
    textDecoration: textDecoration(attributes.underlineStyle, attributes.strikethroughStyle),
  };
}

function exportAttributedString(layer) {
  try {
    let data = sketch.export(layer, { formats: ["json"], output: false });
    if (Array.isArray(data)) data = data[0];
    if (data && !data.attributedString && typeof data.toString === "function") {
      data = JSON.parse(String(data));
    }
    return data && data.attributedString;
  } catch (e) {
    return undefined;
  }
}

function mostCommon(values) {
  const counts = {};
  let best;
  values.forEach((value) => {
    counts[value] = (counts[value] || 0) + 1;
    if (best === undefined || counts[value] > counts[best]) best = value;
  });
  return best;
}
