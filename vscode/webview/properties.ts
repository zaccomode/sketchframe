// A node's (or a style's) design.json fields, grouped and labelled for the
// inspector's GUI view, roughly as Figma's Dev Mode lays them out. Mirrors
// PropertySections.swift; the JSON view still shows everything verbatim.

type JSONObject = Record<string, unknown>;

export type PropertyRow = {
  label: string;
  /** What's shown, and what clicking the row copies. */
  value: string;
  /** CSS colors for a swatch: one for a solid color, the stops of a gradient. */
  swatch?: string[];
  /** The color token the value comes from. */
  token?: string;
  /** Long or multi-line text (text content, CSS), shown under the label. */
  block?: boolean;
};

export type PropertySection = { title: string; rows: PropertyRow[] };

/** Sections for a node's resolved fields (style keys already replaced by their values). */
export function nodeSections(node: JSONObject): PropertySection[] {
  return [
    section('Layer', layerRows(node)),
    section('Position & Size', layoutRows(node)),
    section('Auto Layout', stackRows(node.layout)),
    section('Appearance', appearanceRows(node)),
    section('Text', textRows(node)),
    section('Typography', typographyRows(node.textStyle)),
    section('Fills', paintRows(node.fills)),
    section('Borders', borderRows(node.borders, node.borderOptions)),
    section('Effects', effectRows(node.effects)),
    section('Overrides', overrideRows(node.overrides)),
  ].filter((section) => section.rows.length > 0);
}

/**
 * Sections for a value in design.json's `styles` map. Its key's prefix says
 * which node field it stands in for.
 */
export function styleSections(category: string, value: unknown): PropertySection[] {
  const field: Record<string, string> = {
    fill: 'fills',
    border: 'borders',
    effect: 'effects',
    corner: 'corners',
    layout: 'layout',
    text: 'textStyle',
  };
  const key = field[category];
  return key ? nodeSections({ [key]: value }) : [];
}

/** Sections for a color token. */
export function tokenSections(name: string, value: string, layers: string[]): PropertySection[] {
  return [
    section('Color', [{ label: name, value, swatch: [value] }, ...colorFormats(value)]),
    section(
      'Used By',
      layers.map((layer, index) => ({ label: String(index + 1), value: layer })),
    ),
  ].filter((section) => section.rows.length > 0);
}

// MARK: Sections

function section(title: string, rows: (PropertyRow | undefined)[]): PropertySection {
  return { title, rows: rows.filter((row): row is PropertyRow => row !== undefined) };
}

function row(label: string, value: unknown, extra: Partial<PropertyRow> = {}): PropertyRow | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return { label, value: typeof value === 'number' ? num(value) : String(value), ...extra };
}

function layerRows(node: JSONObject): (PropertyRow | undefined)[] {
  return [
    row('Type', str(node.type)),
    row('Component', str(node.component)),
    row('Shared style', str(node.sharedStyle)),
    row('Asset', str(node.src)),
  ];
}

function layoutRows(node: JSONObject): (PropertyRow | undefined)[] {
  const flips = [node.flipX === true && 'horizontal', node.flipY === true && 'vertical'].filter(Boolean);
  const sizing = obj(node.sizing);
  const constraints = obj(node.constraints);
  return [
    row('Width', px(node.width)),
    row('Height', px(node.height)),
    row('X', px(node.x)),
    row('Y', px(node.y)),
    row('Rotation', typeof node.rotation === 'number' ? `${num(node.rotation)}°` : undefined),
    row('Flipped', flips.join(', ')),
    row('Position', str(node.position)),
    row('Horizontal sizing', str(sizing?.horizontal)),
    row('Vertical sizing', str(sizing?.vertical)),
    row('Min size', sizeText(node.minSize)),
    row('Max size', sizeText(node.maxSize)),
    row('Size %', sizeText(node.percentageSize, (n) => `${num(n * 100)}%`)),
    row('Horizontal constraint', str(constraints?.horizontal)),
    row('Vertical constraint', str(constraints?.vertical)),
    row('Clip content', node.clipContent === true ? 'Yes' : undefined),
  ];
}

function stackRows(value: unknown): (PropertyRow | undefined)[] {
  const layout = obj(value);
  if (!layout) return [];
  return [
    row('Direction', layout.mode === 'column' ? 'Vertical (column)' : 'Horizontal (row)'),
    row('Gap', px(layout.gap)),
    row('Padding', str(layout.padding)),
    row('Justify content', str(layout.justifyContent)),
    row('Align items', str(layout.alignItems)),
    row('Wrap', layout.wrap === true ? 'Yes' : undefined),
    row('Align content', str(layout.alignContent)),
    row('Cross-axis gap', px(layout.crossAxisGap)),
    row('Stacking order', layout.stackingOrder === 'firstOnTop' ? 'First on top' : undefined),
    row('Borders affect layout', layout.bordersAffectLayout === true ? 'Yes' : undefined),
  ];
}

function appearanceRows(node: JSONObject): (PropertyRow | undefined)[] {
  const corners = obj(node.corners);
  const radius = corners?.radius;
  const radiusText =
    typeof radius === 'number'
      ? cornerRadius(radius)
      : Array.isArray(radius)
        ? radius.map((r) => cornerRadius(r) ?? '0').join(' ')
        : undefined;
  const style = str(corners?.style);
  return [
    row('Opacity', typeof node.opacity === 'number' ? `${num(node.opacity * 100)}%` : undefined),
    row('Blend mode', str(node.blendMode)),
    row('Corner radius', radiusText),
    row('Corner style', style ? cornerStyleNames[style] ?? style : undefined),
    row('Smoothing', typeof corners?.smoothing === 'number' ? `${num(corners.smoothing * 100)}%` : undefined),
    row('Concentric', corners?.concentric === true ? 'Yes' : undefined),
  ];
}

const cornerStyleNames: Record<string, string> = {
  smooth: 'Smooth',
  angled: 'Angled',
  insideSquare: 'Inside square',
  insideArc: 'Inside arc',
};

function textRows(node: JSONObject): (PropertyRow | undefined)[] {
  const runs = Array.isArray(node.textRuns) ? node.textRuns.length : 0;
  return [
    row('Content', str(node.text), { block: true }),
    row('Behaviour', str(node.textBehaviour)),
    row('Styled runs', runs > 0 ? String(runs) : undefined),
  ];
}

function typographyRows(value: unknown): (PropertyRow | undefined)[] {
  const text = obj(value);
  if (!text) return [];
  const lineHeight = text.lineHeightAuto === true ? `Auto (${px(text.lineHeight) ?? '—'})` : px(text.lineHeight);
  return [
    row('Font', str(text.fontFamily)),
    row('Font name', str(text.fontName)),
    row('Weight', text.fontWeight),
    row('Style', str(text.fontStyle)),
    row('Size', px(text.fontSize)),
    row('Line height', lineHeight),
    row('Letter spacing', px(text.letterSpacing)),
    row('Paragraph spacing', px(text.paragraphSpacing)),
    row('Align', str(text.textAlign)),
    row('Vertical align', str(text.verticalAlign)),
    row('Transform', str(text.textTransform)),
    row('Decoration', str(text.textDecoration)),
    colorRow('Color', str(text.color), str(text.colorToken)),
  ];
}

function paintRows(value: unknown): (PropertyRow | undefined)[] {
  return list(value).map((paint) => paintRow(paint));
}

function paintRow(paint: JSONObject, prefix = ''): PropertyRow | undefined {
  const type = str(paint.type) ?? 'solid';
  const blend = str(paint.blendMode);
  const suffix = blend ? ` · ${blend}` : '';
  if (type === 'solid') return colorRow(`${prefix}Solid${suffix}`, str(paint.color), str(paint.token));
  if (type === 'image') {
    return row(`${prefix}Image${suffix}`, [str(paint.fit), str(paint.src)].filter(Boolean).join(' · '));
  }
  const stops = list(paint.stops);
  const name = `${type[0].toUpperCase()}${type.slice(1)} gradient${paint.approximate === true ? ' (approx.)' : ''}`;
  const css = str(paint.css) ?? stops.map((stop) => `${str(stop.color)} ${num((number(stop.position) ?? 0) * 100)}%`).join(', ');
  return row(`${prefix}${name}${suffix}`, css, {
    swatch: stops.flatMap((stop) => str(stop.color) ?? []),
    block: true,
  });
}

function borderRows(value: unknown, optionsValue: unknown): (PropertyRow | undefined)[] {
  const rows = list(value).map((border) => {
    const sides = obj(border.sides);
    const sideText = sides
      ? ` (${['top', 'right', 'bottom', 'left'].filter((side) => sides[side] !== false && sides[side] !== 0).join(', ')})`
      : '';
    const prefix = `${px(border.thickness) ?? ''} ${str(border.position) ?? ''}${sideText} · `.trimStart();
    return paintRow(border, prefix);
  });
  const options = obj(optionsValue);
  if (options) {
    const dash = Array.isArray(options.dashPattern) ? options.dashPattern.map((n) => num(Number(n))).join(' ') : undefined;
    rows.push(
      row('Dash pattern', dash),
      row('Line cap', str(options.lineCap)),
      row('Line join', str(options.lineJoin)),
      row('Start arrowhead', str(options.startArrowhead)),
      row('End arrowhead', str(options.endArrowhead)),
    );
  }
  return rows;
}

function effectRows(value: unknown): (PropertyRow | undefined)[] {
  const effects = obj(value);
  if (!effects) return [];
  const shadows = list(effects.shadows).map((shadow) => {
    const offsets = [shadow.x, shadow.y, shadow.blur, shadow.spread].map((n) => px(n) ?? '0').join(' ');
    return colorRow(shadow.inset === true ? 'Inner shadow' : 'Drop shadow', str(shadow.color), str(shadow.token), offsets);
  });
  const blurs = list(effects.blurs).map((blur) => {
    const type = str(blur.type) ?? 'gaussian';
    const details = [px(blur.radius)];
    if (typeof blur.angle === 'number') details.push(`${num(blur.angle)}°`);
    if (blur.progressive) details.push('progressive');
    return row(`${type[0].toUpperCase()}${type.slice(1)} blur`, details.filter(Boolean).join(' · '));
  });
  const css = obj(effects.css) ?? {};
  const cssRows = Object.entries(css).map(([key, value]) => row(cssName(key), str(value), { block: true }));
  return [...shadows, ...blurs, ...cssRows];
}

function overrideRows(value: unknown): (PropertyRow | undefined)[] {
  return list(value).map((override) => {
    const label = [str(override.layer), str(override.property)].filter(Boolean).join(' · ');
    const text = typeof override.value === 'string' ? override.value : JSON.stringify(override.value);
    const color = typeof override.value === 'string' && isColor(override.value) ? [override.value] : undefined;
    return row(label || 'Override', text, { swatch: color });
  });
}

// MARK: Colors

/**
 * A color row copies the hex (or rgba) value. `detail` goes before the color,
 * as for a shadow's offsets.
 */
function colorRow(label: string, color: string | undefined, token: string | undefined, detail?: string) {
  if (!color) return undefined;
  return row(label, detail ? `${detail} ${color}` : color, { swatch: [color], token });
}

/** Hex, RGB(A) and HSL forms of a CSS color, for copying in whichever a codebase uses. */
export function colorFormats(css: string): PropertyRow[] {
  const rgba = parseColor(css);
  if (!rgba) return [];
  const [r, g, b, a] = rgba;
  const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  const alpha = a < 1 ? `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}` : hex;
  const [h, s, l] = hsl(r, g, b);
  return [
    { label: 'Hex', value: alpha.toUpperCase() },
    { label: 'RGB', value: a < 1 ? `rgba(${r}, ${g}, ${b}, ${num(a)})` : `rgb(${r}, ${g}, ${b})` },
    { label: 'HSL', value: a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${num(a)})` : `hsl(${h}, ${s}%, ${l}%)` },
  ];
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(…)` and `rgba(…)`, as 0–255 channels and 0–1 alpha. */
export function parseColor(css: string): [number, number, number, number] | undefined {
  const value = css.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const channel = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return [channel(0), channel(2), channel(4), full.length === 8 ? channel(6) / 255 : 1];
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(value)?.[1];
  if (fn) {
    const parts = fn.split(/[\s,/]+/).filter(Boolean).map(Number);
    if ((parts.length === 3 || parts.length === 4) && parts.every((n) => !Number.isNaN(n))) {
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    }
  }
  return undefined;
}

function isColor(value: string) {
  return parseColor(value) !== undefined;
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  const [rf, gf, bf] = [r / 255, g / 255, b / 255];
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rf) h = 60 * (((gf - bf) / d) % 6);
    else if (max === gf) h = 60 * ((bf - rf) / d + 2);
    else h = 60 * ((rf - gf) / d + 4);
  }
  if (h < 0) h += 360;
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

// MARK: Helpers

function obj(value: unknown): JSONObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JSONObject) : undefined;
}

function list(value: unknown): JSONObject[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): JSONObject[] => {
    const object = obj(item);
    return object ? [object] : [];
  });
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** Up to two decimal places, without trailing zeros. */
export function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function px(value: unknown): string | undefined {
  return typeof value === 'number' ? `${num(value)}px` : undefined;
}

/** Sketch saves a fully rounded corner as the largest 32-bit float (3.4e38),
 * so any radius past this reads as "Full". Matches PropertySections.swift. */
const fullRadius = 1e6;

function cornerRadius(value: unknown): string | undefined {
  if (typeof value !== 'number') return undefined;
  return value >= fullRadius ? 'Full' : px(value);
}

function sizeText(value: unknown, format: (n: number) => string = (n) => `${num(n)}px`): string | undefined {
  const size = obj(value);
  if (!size) return undefined;
  const w = number(size.width);
  const h = number(size.height);
  if (w === undefined && h === undefined) return undefined;
  return `${w === undefined ? '—' : format(w)} × ${h === undefined ? '—' : format(h)}`;
}

/** `boxShadow` → `box-shadow`. */
function cssName(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}
