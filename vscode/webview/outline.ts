// A layer's outline in its own local space (0,0 to width,height), following
// its corners: rounded, smooth (squircle), angled, inside square and inside
// arc, each corner with its own radius, and ellipses for ovals. Mirrors
// Outline.swift. Every curve is a cubic Bézier, so the same segments draw in
// SVG and in a Core Graphics path.

import { apply } from './geometry.ts';
import type { Point, Size, Transform } from './geometry.ts';

export type CornerStyle = 'rounded' | 'smooth' | 'angled' | 'insideSquare' | 'insideArc';

/** How a node's outline is shaped, from its `type` and `corners`. */
export type OutlineShape =
  | { kind: 'rectangle' }
  | { kind: 'oval' }
  | {
      kind: 'rounded';
      /** Top-left, top-right, bottom-right, bottom-left, as in `corners.radius`. */
      radii: [number, number, number, number];
      style: CornerStyle;
      /** 0–1, for smooth corners. */
      smoothing: number;
    };

export type Segment =
  | { type: 'move'; to: Point }
  | { type: 'line'; to: Point }
  | { type: 'cubic'; c1: Point; c2: Point; to: Point }
  | { type: 'close' };

const cornerStyles: CornerStyle[] = ['rounded', 'smooth', 'angled', 'insideSquare', 'insideArc'];

/**
 * Reads a node's outline shape from its `type` and its (resolved) `corners`
 * field, as described in docs/FORMAT.md.
 */
export function outlineShape(type: string, corners: unknown): OutlineShape {
  if (type === 'oval') return { kind: 'oval' };
  if (typeof corners !== 'object' || corners === null) return { kind: 'rectangle' };
  const { radius, style, smoothing } = corners as Record<string, unknown>;
  let radii: [number, number, number, number];
  if (typeof radius === 'number') {
    radii = [radius, radius, radius, radius];
  } else if (Array.isArray(radius) && radius.length === 4 && radius.every((r) => typeof r === 'number')) {
    radii = radius as [number, number, number, number];
  } else {
    return { kind: 'rectangle' };
  }
  radii = radii.map((r) => Math.max(r, 0)) as [number, number, number, number];
  if (radii.every((r) => r === 0)) return { kind: 'rectangle' };
  return {
    kind: 'rounded',
    radii,
    style: cornerStyles.find((known) => known === style) ?? 'rounded',
    smoothing: typeof smoothing === 'number' ? Math.min(Math.max(smoothing, 0), 1) : style === 'smooth' ? 0.6 : 0,
  };
}

/** The outline in the node's local space. */
export function outlineSegments(shape: OutlineShape, size: Size): Segment[] {
  const { width: w, height: h } = size;
  switch (shape.kind) {
    case 'rectangle':
      return [
        { type: 'move', to: { x: 0, y: 0 } },
        { type: 'line', to: { x: w, y: 0 } },
        { type: 'line', to: { x: w, y: h } },
        { type: 'line', to: { x: 0, y: h } },
        { type: 'close' },
      ];
    case 'oval':
      return ellipse(w, h);
    case 'rounded':
      return roundedRectangle(shape, w, h);
  }
}

/** The outline mapped through `transform` (into the root frame's space). */
export function transformSegments(segments: Segment[], transform: Transform): Segment[] {
  const map = (p: Point) => apply(transform, p);
  return segments.map((segment) => {
    switch (segment.type) {
      case 'move':
      case 'line':
        return { type: segment.type, to: map(segment.to) };
      case 'cubic':
        return { type: 'cubic', c1: map(segment.c1), c2: map(segment.c2), to: map(segment.to) };
      case 'close':
        return segment;
    }
  });
}

/** An SVG path `d` attribute. */
export function svgPath(segments: Segment[]): string {
  const p = (point: Point) => `${round(point.x)} ${round(point.y)}`;
  return segments
    .map((segment) => {
      switch (segment.type) {
        case 'move':
          return `M${p(segment.to)}`;
        case 'line':
          return `L${p(segment.to)}`;
        case 'cubic':
          return `C${p(segment.c1)} ${p(segment.c2)} ${p(segment.to)}`;
        case 'close':
          return 'Z';
      }
    })
    .join(' ');
}

const round = (value: number) => Math.round(value * 1000) / 1000;

// MARK: Shapes

/** Four cubic quarter-arcs: the usual 0.5523 approximation of an ellipse. */
function ellipse(w: number, h: number): Segment[] {
  const k = 0.5522847498;
  const rx = w / 2;
  const ry = h / 2;
  return [
    { type: 'move', to: { x: rx, y: 0 } },
    { type: 'cubic', c1: { x: rx + rx * k, y: 0 }, c2: { x: w, y: ry - ry * k }, to: { x: w, y: ry } },
    { type: 'cubic', c1: { x: w, y: ry + ry * k }, c2: { x: rx + rx * k, y: h }, to: { x: rx, y: h } },
    { type: 'cubic', c1: { x: rx - rx * k, y: h }, c2: { x: 0, y: ry + ry * k }, to: { x: 0, y: ry } },
    { type: 'cubic', c1: { x: 0, y: ry - ry * k }, c2: { x: rx - rx * k, y: 0 }, to: { x: rx, y: 0 } },
    { type: 'close' },
  ];
}

/**
 * Each corner is drawn in a canonical frame where the corner sits at the
 * origin, the edge arriving at it runs along +x, and the edge leaving it runs
 * along +y (the top-right corner of a y-down rectangle, travelled clockwise).
 * `u` and `v` rotate that frame onto the real corner.
 */
type CornerFrame = { origin: Point; u: Point; v: Point };

function roundedRectangle(shape: Extract<OutlineShape, { kind: 'rounded' }>, w: number, h: number): Segment[] {
  const radii = clampRadii(shape.radii, w, h);
  // Clockwise from the top-left, each frame's +x runs along the edge that
  // arrives at the corner.
  const frames: CornerFrame[] = [
    { origin: { x: 0, y: 0 }, u: { x: 0, y: -1 }, v: { x: 1, y: 0 } },
    { origin: { x: w, y: 0 }, u: { x: 1, y: 0 }, v: { x: 0, y: 1 } },
    { origin: { x: w, y: h }, u: { x: 0, y: 1 }, v: { x: -1, y: 0 } },
    { origin: { x: 0, y: h }, u: { x: -1, y: 0 }, v: { x: 0, y: -1 } },
  ];
  // A smooth corner's curve reaches up to half the shorter side along each edge.
  const budget = Math.min(w, h) / 2;

  const segments: Segment[] = [];
  frames.forEach((frame, index) => {
    const [start, ...rest] = corner(shape.style, radii[index], shape.smoothing, budget);
    const map = (p: Point): Point => ({
      x: frame.origin.x + frame.u.x * p.x + frame.v.x * p.y,
      y: frame.origin.y + frame.u.y * p.x + frame.v.y * p.y,
    });
    segments.push({ type: index === 0 ? 'move' : 'line', to: map(start.to) });
    for (const segment of rest) {
      segments.push(
        segment.type === 'cubic'
          ? { type: 'cubic', c1: map(segment.c1), c2: map(segment.c2), to: map(segment.to) }
          : { type: 'line', to: map(segment.to) },
      );
    }
  });
  segments.push({ type: 'close' });
  return segments;
}

/**
 * Scales every radius down by the same factor when two neighbours would
 * overlap along a side, as CSS `border-radius` does.
 */
export function clampRadii(radii: readonly number[], w: number, h: number): number[] {
  const [tl, tr, br, bl] = radii;
  const ratios = [
    [w, tl + tr],
    [h, tr + br],
    [w, br + bl],
    [h, bl + tl],
  ]
    .filter(([, sum]) => sum > 0)
    .map(([side, sum]) => side / sum);
  const factor = Math.min(1, ...ratios);
  return radii.map((r) => r * factor);
}

type CornerPoint = { type: 'point'; to: Point };
type CornerCurve = { type: 'cubic'; c1: Point; c2: Point; to: Point };
type CornerLine = { type: 'line'; to: Point };

/**
 * One corner in the canonical frame: a start point at (-reach, 0) on the
 * arriving edge, then segments ending at (0, reach) on the leaving edge.
 */
function corner(
  style: CornerStyle,
  radius: number,
  smoothing: number,
  budget: number,
): [CornerPoint, ...(CornerCurve | CornerLine)[]] {
  if (radius <= 0) return [{ type: 'point', to: { x: 0, y: 0 } }];
  const r = radius;
  switch (style) {
    case 'angled':
      return [{ type: 'point', to: { x: -r, y: 0 } }, { type: 'line', to: { x: 0, y: r } }];
    case 'insideSquare':
      return [
        { type: 'point', to: { x: -r, y: 0 } },
        { type: 'line', to: { x: -r, y: r } },
        { type: 'line', to: { x: 0, y: r } },
      ];
    case 'insideArc':
      // A concave quarter circle centred on the corner itself.
      return [{ type: 'point', to: { x: -r, y: 0 } }, arc({ x: 0, y: 0 }, r, Math.PI, Math.PI / 2)];
    case 'rounded':
      return smoothCorner(r, 0, budget);
    case 'smooth':
      return smoothCorner(r, smoothing, budget);
  }
}

/**
 * Figma-style corner smoothing (as in the figma-squircle package): the curve
 * starts further along each edge (by `1 + smoothing` times the radius), eases
 * in with a cubic, follows a shorter circular arc, and eases out. With no
 * smoothing it's a plain quarter circle.
 */
function smoothCorner(radius: number, smoothing: number, budget: number): [CornerPoint, ...CornerCurve[]] {
  const r = Math.min(radius, budget);
  let s = smoothing;
  let p = (1 + s) * r;
  if (p > budget) {
    s = Math.max(Math.min(s, budget / r - 1), 0);
    p = Math.min(p, budget);
  }
  const degrees = Math.PI / 180;
  const arcMeasure = 90 * (1 - s);
  const arcLength = Math.sin((arcMeasure / 2) * degrees) * r * Math.SQRT2;
  const alpha = (90 - arcMeasure) / 2;
  const p3ToP4 = r * Math.tan((alpha / 2) * degrees);
  const beta = 45 * s;
  const c = p3ToP4 * Math.cos(beta * degrees);
  const d = c * Math.tan(beta * degrees);
  const b = (p - arcLength - c - d) / 3;
  const a = 2 * b;

  const arcStart = { x: -p + a + b + c, y: d };
  const arcEnd = { x: -d, y: p - a - b - c };
  const centre = { x: -r, y: r };
  const angle = (point: Point) => Math.atan2(point.y - centre.y, point.x - centre.x);
  if (s === 0) return [{ type: 'point', to: { x: -r, y: 0 } }, arc(centre, r, -Math.PI / 2, 0)];

  return [
    { type: 'point', to: { x: -p, y: 0 } },
    { type: 'cubic', c1: { x: -p + a, y: 0 }, c2: { x: -p + a + b, y: 0 }, to: arcStart },
    arc(centre, r, angle(arcStart), angle(arcEnd)),
    { type: 'cubic', c1: { x: 0, y: p - a - b }, c2: { x: 0, y: p - a }, to: { x: 0, y: p } },
  ];
}

/** A circular arc of up to 90° as one cubic, from angle `from` to `to` (radians, y-down). */
function arc(centre: Point, r: number, from: number, to: number): CornerCurve {
  const k = (4 / 3) * Math.tan((to - from) / 4);
  const start = { x: centre.x + r * Math.cos(from), y: centre.y + r * Math.sin(from) };
  const end = { x: centre.x + r * Math.cos(to), y: centre.y + r * Math.sin(to) };
  return {
    type: 'cubic',
    c1: { x: start.x - k * r * Math.sin(from), y: start.y + k * r * Math.cos(from) },
    c2: { x: end.x + k * r * Math.sin(to), y: end.y - k * r * Math.cos(to) },
    to: end,
  };
}
