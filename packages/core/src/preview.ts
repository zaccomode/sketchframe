// Where the frame sits inside its preview image. Separate from model.ts so
// the VS Code webview (a browser) can use it without the archive code.

import { isObject, number } from './format.ts';
import type { JSONObject } from './format.ts';
import type { Point, Size } from './geometry.ts';

/**
 * Uses `preview.origin` when the exporter recorded it. Older exports don't
 * have it, so it's derived from the root's shadows and borders (which Sketch
 * renders outside the frame), falling back to an even split when that doesn't
 * account for all of the overflow.
 */
export function frameOrigin(preview: JSONObject, root: JSONObject, styles: JSONObject, overflow: Size): Point {
  if (isObject(preview.origin)) {
    const x = number(preview.origin.x);
    const y = number(preview.origin.y);
    if (x !== undefined && y !== undefined) return { x, y };
  }

  const resolved = (field: string) => (typeof root[field] === 'string' ? styles[root[field]] : root[field]);

  let left = 0;
  let top = 0;
  let right = 0;
  let bottom = 0;
  const extend = (l: number, t: number, r: number, b: number) => {
    left = Math.max(left, l);
    top = Math.max(top, t);
    right = Math.max(right, r);
    bottom = Math.max(bottom, b);
  };

  const effects = resolved('effects');
  const shadows = isObject(effects) && Array.isArray(effects.shadows) ? effects.shadows.filter(isObject) : [];
  for (const shadow of shadows) {
    if (shadow.inset === true) continue;
    const x = number(shadow.x) ?? 0;
    const y = number(shadow.y) ?? 0;
    const reach = (number(shadow.blur) ?? 0) + (number(shadow.spread) ?? 0);
    extend(reach - x, reach - y, reach + x, reach + y);
  }
  const borders = resolved('borders');
  for (const border of Array.isArray(borders) ? borders.filter(isObject) : []) {
    const thickness = number(border.thickness) ?? 0;
    if (border.position === 'outside') extend(thickness, thickness, thickness, thickness);
    if (border.position === 'center') extend(thickness / 2, thickness / 2, thickness / 2, thickness / 2);
  }

  return {
    x: Math.abs(left + right - overflow.width) <= 1 ? left : overflow.width / 2,
    y: Math.abs(top + bottom - overflow.height) <= 1 ? top : overflow.height / 2,
  };
}
