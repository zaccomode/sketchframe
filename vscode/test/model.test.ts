import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ancestorIds,
  annotationsFileText,
  corners,
  hitTest,
  newAnnotation,
  nodeForAnnotation,
  nodeWithId,
  parseAnnotations,
  parsePackage,
  SketchframeError,
} from '../webview/model.ts';
import type { SketchframePackage } from '../webview/model.ts';

const fixture = new URL('fixtures/Cards.sketchframe/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, fixture), 'utf8');
const pkg: SketchframePackage = parsePackage(read('design.json'), read('annotations.json'));

const node = (id: string) => {
  const found = nodeWithId(pkg, id);
  assert.ok(found, `no node ${id}`);
  return found;
};

/** Rounded, so floating-point noise from rotation doesn't fail comparisons. */
const rounded = (points: { x: number; y: number }[]) =>
  points.map((p) => ({ x: Math.round(p.x * 1000) / 1000 + 0, y: Math.round(p.y * 1000) / 1000 + 0 }));

test('reads the package summary', () => {
  assert.equal(pkg.name, 'Cards');
  assert.equal(pkg.nodeCount, 6, 'component layers do not count');
  assert.deepEqual(pkg.previewSize, { width: 248, height: 198 });
  assert.deepEqual(pkg.frameOrigin, { x: 24, y: 16 });
});

test('derives the frame origin from shadows when the export has none', () => {
  const design = JSON.parse(read('design.json'));
  delete design.preview.origin;
  // A 0 8 24 shadow reaches 24 left and right, 16 above and 32 below.
  assert.deepEqual(parsePackage(JSON.stringify(design), null).frameOrigin, { x: 24, y: 16 });
});

test('measures the frame origin over a stale recorded one', () => {
  const design = JSON.parse(read('design.json'));
  design.preview.origin = { x: 0, y: 0 };
  assert.deepEqual(parsePackage(JSON.stringify(design), null).frameOrigin, { x: 24, y: 16 });
});

test('positions nodes relative to their parent', () => {
  assert.deepEqual(rounded(corners(node('n2'))), [
    { x: 20, y: 20 },
    { x: 80, y: 20 },
    { x: 80, y: 60 },
    { x: 20, y: 60 },
  ]);
});

test('rotates clockwise around the centre, and children rotate with their parent', () => {
  // An 80×40 group at (100, 50), turned 90° clockwise about its centre
  // (140, 70): its top-left corner swings to the top-right.
  assert.deepEqual(rounded(corners(node('n3'))), [
    { x: 160, y: 30 },
    { x: 160, y: 110 },
    { x: 120, y: 110 },
    { x: 120, y: 30 },
  ]);
  assert.deepEqual(rounded(corners(node('n4')))[0], { x: 160, y: 30 });
});

test('hit-tests the topmost, deepest node', () => {
  assert.equal(hitTest(pkg, { x: 30, y: 30 })?.id, 'n2');
  assert.equal(hitTest(pkg, { x: 155, y: 35 })?.id, 'n4', 'inside the rotated child');
  assert.equal(hitTest(pkg, { x: 125, y: 100 })?.id, 'n3', 'inside the rotated group only');
  assert.equal(hitTest(pkg, { x: 5, y: 140 })?.id, 'n1');
  assert.equal(hitTest(pkg, { x: 500, y: 500 }), undefined);
});

test('resolves shared style keys in details', () => {
  const details = JSON.parse(node('n2').details);
  assert.deepEqual(details.fills, [{ type: 'solid', color: '#ffffff', token: 'Neutral/White' }]);
  assert.deepEqual(node('n2').styleKeys, ['fill_aaaa0001']);
  assert.ok(node('n2').tokens.has('Neutral/White'), 'tokens are read through resolved styles');
});

test('lists components with their instances', () => {
  assert.equal(pkg.components.length, 1);
  const [badge] = pkg.components;
  assert.equal(badge.name, 'Badge');
  assert.equal(badge.library, 'Core UI');
  assert.deepEqual(badge.instances.map((n) => n.id), ['n5']);
  assert.deepEqual(ancestorIds(pkg, 'n8'), ['n7'], 'finds ancestors inside component definitions');
});

test('lists shared styles, reused styles and tokens with their users', () => {
  assert.deepEqual(
    pkg.styles.map((s) => [s.id, s.nodeIds]),
    [
      ['shared:Surface', ['n2']],
      ['style:fill_aaaa0001', ['n2', 'n4']],
    ],
  );
  assert.deepEqual(
    pkg.colorTokens.map((t) => [t.name, t.nodeIds]),
    [
      ['Brand/Blue', ['n1']],
      ['Neutral/White', ['n2', 'n4']],
    ],
  );
});

test('re-attaches annotations by sketchId, then layer path, then node id', () => {
  const attached = Object.fromEntries(pkg.annotations.map((a) => [a.id, nodeForAnnotation(pkg, a)?.id]));
  assert.deepEqual(attached, { A1: 'n2', A2: 'n4', A3: 'n5', A4: undefined });
  assert.equal(pkg.annotations.find((a) => a.id === 'A3')?.category, 'content');
});

test('writes annotations the Mac app can read back', () => {
  const annotation = newAnnotation(node('n4'), 'accessibility', 'Needs a label');
  assert.match(annotation.id, /^[0-9A-F-]{36}$/, 'an uppercase UUID, like Swift writes');
  assert.match(annotation.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, 'no fractional seconds');
  assert.deepEqual(annotation.layerPath, ['Tilted', 'Inner']);
  assert.equal(annotation.sketchId, '33333333');

  const text = annotationsFileText([annotation]);
  const file = JSON.parse(text);
  assert.equal(file.version, 1);
  assert.deepEqual(Object.keys(file.annotations[0]), [...Object.keys(file.annotations[0])].sort(), 'sorted keys');
  assert.ok(!('updatedAt' in file.annotations[0]), 'unset fields are left out');
  assert.deepEqual(parseAnnotations(text), [{ ...annotation, updatedAt: undefined }]);
});

test('rejects files that are not Sketchframes', () => {
  assert.throws(() => parsePackage('{"format": "something-else", "root": {}}', null), SketchframeError);
  assert.throws(() => parsePackage('not json', null), SketchframeError);
});
