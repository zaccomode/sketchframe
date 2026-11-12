// A starting point in HTML and CSS for one node: the closest thing to Figma's
// get_design_context. Stacks become flexbox, everything else is positioned
// absolutely, and colours that come from tokens become CSS variables, so an
// agent can map them onto the target codebase's own variables.
//
// It is a sketch of the structure and styles, not production markup: names
// become class names, images point at paths inside the Sketchframe, and
// paints CSS can't express exactly are marked with a comment.

import { isObject, number, string } from './format.ts';
import type { JSONObject } from './format.ts';
import { isMissingAsset, resolvedFields } from './model.ts';
import type { Node, Sketchframe } from './model.ts';

export function htmlForNode(frame: Sketchframe, node: Node): string {
  const rules: string[] = [];
  const usedTokens = new Set<string>();
  const classNames = new Map<string, number>();

  const className = (current: Node) => {
    const base =
      (current.name || current.type)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || current.type;
    const safe = /^[a-z]/.test(base) ? base : `n-${base}`;
    const count = (classNames.get(safe) ?? 0) + 1;
    classNames.set(safe, count);
    return count === 1 ? safe : `${safe}-${count}`;
  };

  const color = (value: unknown, token: unknown) => {
    if (typeof token === 'string' && frame.colors[token] !== undefined) {
      usedTokens.add(token);
      return `var(${tokenVariable(token)}, ${frame.colors[token]})`;
    }
    return string(value) ?? 'transparent';
  };

  const render = (current: Node, parent: Node | undefined, depth: number): string => {
    const fields = resolvedFields(frame, current);
    const parentLayout = parent ? resolvedFields(frame, parent).layout : undefined;
    const inFlow = isObject(parentLayout) && fields.position !== 'absolute';
    const name = className(current);
    const css: string[] = [];
    const notes: string[] = [];

    // Box and position.
    if (!parent) {
      css.push('position: relative');
    } else if (!inFlow) {
      css.push('position: absolute', `left: ${px(fields.x)}`, `top: ${px(fields.y)}`);
    } else {
      css.push('position: relative');
    }
    const sizing = isObject(fields.sizing) ? fields.sizing : {};
    const parentMode = isObject(parentLayout) ? parentLayout.mode : undefined;
    const axis = (dimension: 'width' | 'height', mode: unknown) => {
      const main = (parentMode === 'row') === (dimension === 'width');
      if (mode === 'fill' && inFlow) css.push(main ? 'flex: 1 1 0' : 'align-self: stretch');
      else if (mode === 'hug') css.push(`${dimension}: fit-content`);
      else css.push(`${dimension}: ${px(fields[dimension])}`);
    };
    axis('width', sizing.horizontal);
    axis('height', sizing.vertical);
    for (const [key, property] of [
      ['minSize', 'min'],
      ['maxSize', 'max'],
    ] as const) {
      const size = fields[key];
      if (isObject(size)) {
        if (number(size.width) !== undefined) css.push(`${property}-width: ${px(size.width)}`);
        if (number(size.height) !== undefined) css.push(`${property}-height: ${px(size.height)}`);
      }
    }
    css.push('box-sizing: border-box');

    // Layout.
    const layout = fields.layout;
    if (isObject(layout)) {
      css.push('display: flex', `flex-direction: ${layout.mode === 'column' ? 'column' : 'row'}`);
      if (layout.justifyContent) css.push(`justify-content: ${layout.justifyContent}`);
      if (layout.alignItems) css.push(`align-items: ${layout.alignItems}`);
      if (number(layout.gap) !== undefined) css.push(`gap: ${px(layout.gap)}`);
      if (layout.padding) css.push(`padding: ${layout.padding}`);
      if (layout.wrap) {
        css.push('flex-wrap: wrap');
        if (layout.alignContent) css.push(`align-content: ${layout.alignContent}`);
        if (number(layout.crossAxisGap) !== undefined) css.push(`row-gap: ${px(layout.crossAxisGap)}`);
      }
    }
    if (fields.clipContent === true) css.push('overflow: hidden');

    // Transform.
    const transforms: string[] = [];
    if (number(fields.rotation)) transforms.push(`rotate(${fields.rotation}deg)`);
    if (fields.flipX === true || fields.flipY === true) {
      transforms.push(`scale(${fields.flipX === true ? -1 : 1}, ${fields.flipY === true ? -1 : 1})`);
    }
    if (transforms.length) css.push(`transform: ${transforms.join(' ')}`);
    if (number(fields.opacity) !== undefined) css.push(`opacity: ${fields.opacity}`);
    if (string(fields.blendMode)) css.push(`mix-blend-mode: ${fields.blendMode}`);

    // Fills: CSS backgrounds are top-most first, like design.json.
    const fills = Array.isArray(fields.fills) ? fields.fills.filter(isObject) : [];
    const isText = current.type === 'text';
    if (!isText && fills.length) {
      const layers = fills.map((paint) => {
        if (paint.approximate === true) notes.push(`${paint.type} gradient is approximate; check the preview`);
        if (paint.type === 'solid') {
          const value = color(paint.color, paint.token);
          return fills.length === 1 ? value : `linear-gradient(${value}, ${value})`;
        }
        if (paint.type === 'image') return `url("${paint.src}") center / ${paint.fit === 'stretch' ? '100% 100%' : paint.fit === 'tile' ? 'auto' : paint.fit ?? 'cover'} ${paint.fit === 'tile' ? 'repeat' : 'no-repeat'}`;
        return string(paint.css) ?? 'transparent';
      });
      css.push(`background: ${layers.join(', ')}`);
    }

    // Borders: the top-most one. Inside borders don't change the box's size.
    const borders = Array.isArray(fields.borders) ? fields.borders.filter(isObject) : [];
    if (borders.length) {
      const border = borders[0];
      const thickness = number(border.thickness) ?? 1;
      const value = border.type === 'solid' || border.type === undefined ? color(border.color, border.token) : 'currentColor';
      if (border.type && border.type !== 'solid') notes.push('gradient border; check the preview');
      if (border.position === 'outside') css.push(`outline: ${px(thickness)} solid ${value}`);
      else if (border.position === 'center') css.push(`outline: ${px(thickness)} solid ${value}`, `outline-offset: ${px(-thickness / 2)}`);
      else css.push(`border: ${px(thickness)} solid ${value}`);
      const options = isObject(fields.borderOptions) ? fields.borderOptions : {};
      if (Array.isArray(options.dashPattern) && options.dashPattern.length) css.push('border-style: dashed');
      if (borders.length > 1) notes.push(`${borders.length - 1} more border(s) in the design`);
    }

    // Corners.
    const corners = isObject(fields.corners) ? fields.corners : undefined;
    if (corners) {
      const radius = corners.radius;
      if (Array.isArray(radius)) css.push(`border-radius: ${radius.map(px).join(' ')}`);
      else if (number(radius) !== undefined) css.push(`border-radius: ${current.type === 'oval' ? '50%' : px(radius)}`);
      if (corners.style === 'smooth') notes.push('smooth (squircle) corners');
    } else if (current.type === 'oval') {
      css.push('border-radius: 50%');
    }

    // Effects: the exporter already worked out the CSS.
    const effects = isObject(fields.effects) ? fields.effects : undefined;
    const effectCSS = effects && isObject(effects.css) ? effects.css : {};
    if (string(effectCSS.boxShadow) && !isText) css.push(`box-shadow: ${effectCSS.boxShadow}`);
    if (string(effectCSS.textShadow)) css.push(`text-shadow: ${effectCSS.textShadow}`);
    if (string(effectCSS.filter)) css.push(`filter: ${effectCSS.filter}`);
    if (string(effectCSS.backdropFilter)) css.push(`backdrop-filter: ${effectCSS.backdropFilter}`);

    // Text.
    const textStyle = isObject(fields.textStyle) ? fields.textStyle : undefined;
    if (isText && textStyle) css.push(...textCSS(textStyle, color));
    if (isText && fields.textBehaviour === 'auto-width') css.push('white-space: nowrap');
    if (isText && Array.isArray(fields.textRuns) && fields.textRuns.length) notes.push('mixed text styles; see textRuns');
    const missing = isMissingAsset(frame, current);
    if (missing) notes.push("placeholder for a vector that couldn't be exported");

    rules.push(`${notes.length ? `/* ${notes.join('; ')} */\n` : ''}.${name} {\n${css.map((line) => `  ${line};`).join('\n')}\n}`);

    const indent = '  '.repeat(depth);
    const label = current.name ? ` data-name="${attribute(current.name)}"` : '';
    if (isText) {
      return `${indent}<p class="${name}"${label}>${escape(string(fields.text) ?? '').replace(/\n/g, '<br>')}</p>`;
    }
    if ((current.type === 'image' || current.type === 'vector') && string(fields.src)) {
      return `${indent}<img class="${name}"${label} src="${attribute(string(fields.src) ?? '')}" alt="${attribute(current.name)}">`;
    }
    if (missing) {
      return `${indent}<!-- vector "${comment(current.name)}" (${current.id}) couldn't be exported; rebuild it from the preview or ask for the asset -->\n${indent}<div class="${name}"${label} data-missing-asset></div>`;
    }
    // Children are back to front, like the DOM; a stack with `firstOnTop`
    // reverses that.
    const children =
      isObject(layout) && layout.stackingOrder === 'firstOnTop'
        ? current.children.map((child, index) => ({ child, z: current.children.length - index }))
        : current.children.map((child) => ({ child, z: 0 }));
    const inner = children.map(({ child }) => render(child, current, depth + 1));
    children.forEach(({ z }, index) => {
      if (z) rules.push(`.${name} > :nth-child(${index + 1}) { z-index: ${z}; }`);
    });
    return inner.length
      ? `${indent}<div class="${name}"${label}>\n${inner.join('\n')}\n${indent}</div>`
      : `${indent}<div class="${name}"${label}></div>`;
  };

  const html = render(node, undefined, 0);
  const variables = [...usedTokens]
    .sort()
    .map((token) => `  ${tokenVariable(token)}: ${frame.colors[token]}; /* token "${token}" */`);
  const style = [variables.length ? `:root {\n${variables.join('\n')}\n}` : '', ...rules].filter(Boolean).join('\n\n');
  return `<!-- "${node.name}" (${node.id}) from ${frame.name}.sketchframe. Image paths are inside the Sketchframe. -->\n<style>\n${style}\n</style>\n\n${html}\n`;
}

function textCSS(style: JSONObject, color: (value: unknown, token: unknown) => string): string[] {
  const css: string[] = [];
  if (string(style.fontFamily)) css.push(`font-family: ${JSON.stringify(style.fontFamily)}`);
  if (number(style.fontWeight) !== undefined) css.push(`font-weight: ${style.fontWeight}`);
  if (string(style.fontStyle) && style.fontStyle !== 'normal') css.push(`font-style: ${style.fontStyle}`);
  if (number(style.fontSize) !== undefined) css.push(`font-size: ${px(style.fontSize)}`);
  if (number(style.lineHeight) !== undefined && style.lineHeightAuto !== true) css.push(`line-height: ${px(style.lineHeight)}`);
  if (number(style.letterSpacing)) css.push(`letter-spacing: ${px(style.letterSpacing)}`);
  if (string(style.textTransform) && style.textTransform !== 'none') css.push(`text-transform: ${style.textTransform}`);
  if (string(style.textAlign)) css.push(`text-align: ${style.textAlign === 'justified' ? 'justify' : style.textAlign}`);
  if (string(style.textDecoration) && style.textDecoration !== 'none') css.push(`text-decoration: ${style.textDecoration}`);
  if (style.color !== undefined || style.colorToken !== undefined) css.push(`color: ${color(style.color, style.colorToken)}`);
  css.push('margin: 0');
  return css;
}

/** `Primary/500` → `--primary-500`. */
export function tokenVariable(token: string): string {
  return `--${token.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'token'}`;
}

function px(value: unknown): string {
  const n = typeof value === 'number' ? value : 0;
  return n === 0 ? '0' : `${Math.round(n * 100) / 100}px`;
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Keeps a name from closing an HTML comment early. */
function comment(text: string): string {
  return text.replace(/--/g, '- -');
}

function attribute(text: string): string {
  return escape(text).replace(/"/g, '&quot;');
}
