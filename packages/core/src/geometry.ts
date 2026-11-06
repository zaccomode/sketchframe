// A 2D affine transform with Core Graphics' conventions, so the maths reads
// the same as SketchframePackage.swift: a point maps to
// (a·x + c·y + tx, b·x + d·y + ty), and `concat(m, n)` applies m, then n.

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Transform = { a: number; b: number; c: number; d: number; tx: number; ty: number };

export const identity: Transform = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export const translate = (tx: number, ty: number): Transform => ({ ...identity, tx, ty });

export const scale = (sx: number, sy: number): Transform => ({ ...identity, a: sx, d: sy });

/** Positive angles turn clockwise in a y-down space, matching CSS. */
export function rotate(degrees: number): Transform {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 };
}

export function concat(m: Transform, n: Transform): Transform {
  return {
    a: m.a * n.a + m.b * n.c,
    b: m.a * n.b + m.b * n.d,
    c: m.c * n.a + m.d * n.c,
    d: m.c * n.b + m.d * n.d,
    tx: m.tx * n.a + m.ty * n.c + n.tx,
    ty: m.tx * n.b + m.ty * n.d + n.ty,
  };
}

export function apply(t: Transform, p: Point): Point {
  return { x: t.a * p.x + t.c * p.y + t.tx, y: t.b * p.x + t.d * p.y + t.ty };
}

export function invert(t: Transform): Transform {
  const det = t.a * t.d - t.b * t.c;
  if (det === 0) return identity;
  return {
    a: t.d / det,
    b: -t.b / det,
    c: -t.c / det,
    d: t.a / det,
    tx: (t.c * t.ty - t.d * t.tx) / det,
    ty: (t.b * t.tx - t.a * t.ty) / det,
  };
}
