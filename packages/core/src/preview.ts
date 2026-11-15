// Where the frame sits inside its preview image. Separate from model.ts so
// the VS Code webview (a browser) can use it without the archive code.

import { isObject, number } from './format.ts';
import type { JSONObject } from './format.ts';
import type { Point, Size } from './geometry.ts';

/**
 * Measures where the frame sits the way the exporter does: every node's
 * frame, grown by its outer shadows and outside/centre borders (Sketch
 * renders those of descendants too, even inside a clipping frame), rounded
 * outwards to whole points. On an axis where that matches the preview, the
 * measurement wins, since exporters before 0.6.1 only measured the root and
 * recorded a wrong `preview.origin` when a child's shadow spilled out.
 * Otherwise `preview.origin` is used when recorded, else the overflow is
 * assumed to be split evenly.
 */
export function frameOrigin(preview: JSONObject, root: JSONObject, styles: JSONObject, overflow: Size): Point {
  const recorded = isObject(preview.origin) ? preview.origin : undefined;
  const recordedX = recorded ? number(recorded.x) : undefined;
  const recordedY = recorded ? number(recorded.y) : undefined;
  const fallback = {
    x: recordedX !== undefined && recordedY !== undefined ? recordedX : overflow.width / 2,
    y: recordedX !== undefined && recordedY !== undefined ? recordedY : overflow.height / 2,
  };

  const width = number(root.width) ?? 0;
  const height = number(root.height) ?? 0;
  const bounds = renderedBounds(root, styles);
  const left = Math.floor(bounds.left);
  const top = Math.floor(bounds.top);
  const measuredWidth = Math.ceil(bounds.right) - left;
  const measuredHeight = Math.ceil(bounds.bottom) - top;

  return {
    x: Math.abs(measuredWidth - (width + overflow.width)) <= 1 ? -left : fallback.x,
    y: Math.abs(measuredHeight - (height + overflow.height)) <= 1 ? -top : fallback.y,
  };
}

type Bounds = { left: number; top: number; right: number; bottom: number };

/** The area the root and its descendants draw into, in the root's coordinates. */
function renderedBounds(root: JSONObject, styles: JSONObject): Bounds {
  const bounds: Bounds = { left: 0, top: 0, right: number(root.width) ?? 0, bottom: number(root.height) ?? 0 };
  const include = (left: number, top: number, right: number, bottom: number) => {
    bounds.left = Math.min(bounds.left, left);
    bounds.top = Math.min(bounds.top, top);
    bounds.right = Math.max(bounds.right, right);
    bounds.bottom = Math.max(bounds.bottom, bottom);
  };
  // Shared values are stored once under `styles` and referenced by key.
  const resolved = (node: JSONObject, field: string) => (typeof node[field] === 'string' ? styles[node[field]] : node[field]);

  const visit = (node: JSONObject, parentX: number, parentY: number) => {
    const x = parentX + (node === root ? 0 : (number(node.x) ?? 0));
    const y = parentY + (node === root ? 0 : (number(node.y) ?? 0));
    const right = x + (number(node.width) ?? 0);
    const bottom = y + (number(node.height) ?? 0);

    const effects = resolved(node, 'effects');
    const shadows = isObject(effects) && Array.isArray(effects.shadows) ? effects.shadows.filter(isObject) : [];
    for (const shadow of shadows) {
      if (shadow.inset === true) continue;
      const dx = number(shadow.x) ?? 0;
      const dy = number(shadow.y) ?? 0;
      const reach = (number(shadow.blur) ?? 0) + (number(shadow.spread) ?? 0);
      include(x + dx - reach, y + dy - reach, right + dx + reach, bottom + dy + reach);
    }
    const borders = resolved(node, 'borders');
    for (const border of Array.isArray(borders) ? borders.filter(isObject) : []) {
      const thickness = number(border.thickness) ?? 0;
      const reach = border.position === 'outside' ? thickness : border.position === 'center' ? thickness / 2 : 0;
      include(x - reach, y - reach, right + reach, bottom + reach);
    }

    for (const child of Array.isArray(node.children) ? node.children.filter(isObject) : []) visit(child, x, y);
  };
  visit(root, 0, 0);
  return bounds;
}
