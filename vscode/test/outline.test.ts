import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rotate } from '../webview/geometry.ts';
import { clampRadii, outlineSegments, outlineShape, svgPath, transformSegments } from '../webview/outline.ts';
import type { Segment } from '../webview/outline.ts';

const size = { width: 100, height: 60 };

/** Every point a path passes through (ends of segments, not control points). */
const ends = (segments: Segment[]) =>
  segments.flatMap((segment) => (segment.type === 'close' ? [] : [segment.to])).map(round);
const round = (p: { x: number; y: number }) => ({ x: Math.round(p.x * 1000) / 1000 + 0, y: Math.round(p.y * 1000) / 1000 + 0 });

test('reads the outline shape from type and corners', () => {
  assert.deepEqual(outlineShape('rectangle', undefined), { kind: 'rectangle' });
  assert.deepEqual(outlineShape('rectangle', { radius: 0 }), { kind: 'rectangle' });
  assert.deepEqual(outlineShape('oval', { radius: 8 }), { kind: 'oval' });
  assert.deepEqual(outlineShape('frame', { radius: 8 }), {
    kind: 'rounded',
    radii: [8, 8, 8, 8],
    style: 'rounded',
    smoothing: 0,
  });
  assert.deepEqual(outlineShape('frame', { radius: [4, 0, 8, 0], style: 'smooth', smoothing: 0.6 }), {
    kind: 'rounded',
    radii: [4, 0, 8, 0],
    style: 'smooth',
    smoothing: 0.6,
  });
  // An unknown style draws as rounded rather than failing.
  assert.equal(outlineShape('frame', { radius: 4, style: 'mystery' }).kind, 'rounded');
});

test('square corners trace the bounds', () => {
  assert.deepEqual(ends(outlineSegments({ kind: 'rectangle' }, size)), [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 60 },
    { x: 0, y: 60 },
  ]);
});

test('rounded corners start and end a radius from each corner', () => {
  const segments = outlineSegments(outlineShape('rectangle', { radius: 10 }), size);
  assert.deepEqual(ends(segments), [
    { x: 0, y: 10 },
    { x: 10, y: 0 },
    { x: 90, y: 0 },
    { x: 100, y: 10 },
    { x: 100, y: 50 },
    { x: 90, y: 60 },
    { x: 10, y: 60 },
    { x: 0, y: 50 },
  ]);
  // Each arc is a quarter circle around the inset centre: its midpoint is a
  // radius from (10, 10).
  const arc = segments[1];
  assert.equal(arc.type, 'cubic');
  if (arc.type === 'cubic') {
    const mid = {
      x: (0 + 3 * arc.c1.x + 3 * arc.c2.x + arc.to.x) / 8,
      y: (10 + 3 * arc.c1.y + 3 * arc.c2.y + arc.to.y) / 8,
    };
    assert.ok(Math.abs(Math.hypot(mid.x - 10, mid.y - 10) - 10) < 0.01);
  }
});

test('each corner keeps its own radius', () => {
  const points = ends(outlineSegments(outlineShape('rectangle', { radius: [0, 20, 0, 5] }), size));
  assert.deepEqual(points[0], { x: 0, y: 0 });
  assert.ok(points.some((p) => p.x === 80 && p.y === 0));
  assert.ok(points.some((p) => p.x === 100 && p.y === 20));
  assert.ok(points.some((p) => p.x === 5 && p.y === 60));
  assert.ok(points.some((p) => p.x === 0 && p.y === 55));
});

test('radii too big for the layer shrink together, like CSS', () => {
  assert.deepEqual(clampRadii([60, 60, 60, 60], 100, 60), [30, 30, 30, 30]);
  assert.deepEqual(clampRadii([10, 0, 0, 0], 100, 60), [10, 0, 0, 0]);
});

test('angled, inside square and inside arc corners', () => {
  const angled = ends(outlineSegments(outlineShape('rectangle', { radius: 10, style: 'angled' }), size));
  assert.deepEqual(angled.slice(0, 3), [
    { x: 0, y: 10 },
    { x: 10, y: 0 },
    { x: 90, y: 0 },
  ]);
  const square = ends(outlineSegments(outlineShape('rectangle', { radius: 10, style: 'insideSquare' }), size));
  assert.deepEqual(square.slice(0, 4), [
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
    { x: 90, y: 0 },
  ]);
  const insideArc = outlineSegments(outlineShape('rectangle', { radius: 10, style: 'insideArc' }), size);
  const curve = insideArc[1];
  assert.equal(curve.type, 'cubic');
  // Concave: the curve bulges into the layer, towards (10, 10).
  if (curve.type === 'cubic') assert.ok(curve.c1.x > 5 && curve.c2.y > 5);
});

test('smooth corners reach further along the edges than rounded ones', () => {
  const smooth = ends(outlineSegments(outlineShape('rectangle', { radius: 10, style: 'smooth', smoothing: 0.6 }), size));
  assert.deepEqual(smooth[0], { x: 0, y: 16 });
  assert.ok(smooth.some((p) => p.x === 16 && p.y === 0));
  // Smoothing is cut back when the curve would pass the middle of a side.
  const tight = ends(outlineSegments(outlineShape('rectangle', { radius: 30, style: 'smooth', smoothing: 1 }), size));
  assert.deepEqual(tight[0], { x: 0, y: 30 });
});

test('ovals are ellipses through the middle of each side', () => {
  assert.deepEqual(ends(outlineSegments({ kind: 'oval' }, size)), [
    { x: 50, y: 0 },
    { x: 100, y: 30 },
    { x: 50, y: 60 },
    { x: 0, y: 30 },
    { x: 50, y: 0 },
  ]);
});

test('outlines follow the layer transform and print as SVG', () => {
  const segments = transformSegments(outlineSegments({ kind: 'rectangle' }, { width: 10, height: 20 }), rotate(90));
  assert.deepEqual(ends(segments), [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: -20, y: 10 },
    { x: -20, y: 0 },
  ]);
  assert.equal(svgPath(outlineSegments({ kind: 'rectangle' }, { width: 10, height: 20 })), 'M0 0 L10 0 L10 20 L0 20 Z');
});
