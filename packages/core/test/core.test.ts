import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { strToU8 } from '../src/archive.ts';
import { crc32, unzip, zip } from '../src/zip.ts';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { cropPNG, pngHeader } from '../src/png.ts';
import { frameOrigin } from '../src/preview.ts';
import {
  archiveFiles,
  bounds,
  catText,
  findNode,
  hasSketchframeMimetype,
  htmlForNode,
  loadSketchframe,
  MIMETYPE,
  nodeContext,
  nodeForAnnotation,
  outline,
  previewRegion,
  readArchive,
  requireNode,
  summary,
  tokens,
  updateArchive,
  writeArchive,
  annotations,
} from '../src/index.ts';
import { cropPreview } from '../src/crop.ts';
import { extract, folderFiles, openSketchframe, pack, saveAnnotations, findSketchframes } from '../src/node.ts';
import { toolNamed, tools } from '../src/tools.ts';

const fixture = fileURLToPath(new URL('fixtures/Cards.sketchframe', import.meta.url));
const scratch = () => mkdtempSync(join(tmpdir(), 'sketchframe-test-'));

function archiveOfFixture(): Uint8Array {
  const files = folderFiles(fixture);
  return writeArchive(new Map(files.paths().map((path) => [path, files.read(path)!])));
}

test('writes the mimetype first, stored, so the file can be sniffed', () => {
  const bytes = archiveOfFixture();
  assert.ok(hasSketchframeMimetype(bytes));
  // Bytes 30.. are the first entry's name; its stored contents follow.
  assert.equal(new TextDecoder().decode(bytes.subarray(30, 38)), 'mimetype');
  assert.equal(new TextDecoder().decode(bytes.subarray(38, 38 + MIMETYPE.length)), MIMETYPE);
  assert.equal(hasSketchframeMimetype(zip([{ name: 'design.json', data: strToU8('{}') }])), false);
});

test('stores images and deflates text', () => {
  const bytes = archiveOfFixture();
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const methods = new Map<string, number>();
  // Walk the central directory.
  let eocd = bytes.length - 22;
  while (view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  let offset = view.getUint32(eocd + 16, true);
  const count = view.getUint16(eocd + 10, true);
  const order: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    methods.set(name, view.getUint16(offset + 10, true));
    order.push(name);
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  assert.deepEqual(order, ['mimetype', 'design.json', 'annotations.json', 'preview@2x.png']);
  assert.equal(methods.get('preview@2x.png'), 0);
  assert.equal(methods.get('design.json'), 8);
});

test('reads an archive and a folder the same way', () => {
  const fromArchive = loadSketchframe(archiveFiles(archiveOfFixture()));
  const fromFolder = loadSketchframe(folderFiles(fixture));
  assert.equal(fromArchive.files.kind, 'archive');
  assert.equal(fromFolder.files.kind, 'folder');
  assert.equal(outline(fromArchive), outline(fromFolder));
  assert.equal(fromArchive.annotations.length, 4);
  assert.deepEqual(fromArchive.frameOrigin, { x: 24, y: 16 });
});

test("measures the frame origin from children's shadows, over a stale recorded one", () => {
  // From #33: exporters before 0.6.1 only measured the root, so a child's
  // shadow spilling 26pt left of the frame was recorded as an even split.
  const root = {
    width: 530,
    height: 288,
    borders: [{ position: 'center', thickness: 1 }],
    children: [{ x: 24, y: 24, width: 168, height: 32, effects: 'effect_1' }],
  };
  const styles = { effect_1: { shadows: [{ x: 0, y: 9, blur: 20 }, { x: 0, y: 83, blur: 50 }, { inset: true, blur: 6 }] } };
  const overflow = { width: 557 - 530, height: 290 - 288 };
  assert.deepEqual(frameOrigin({ origin: { x: 13.5, y: 1 } }, root, styles, overflow), { x: 26, y: 1 });
  assert.deepEqual(frameOrigin({}, root, styles, overflow), { x: 26, y: 1 });

  // When the measurement can't explain the preview (e.g. rotated layers),
  // the recorded origin is used, else an even split.
  const unexplained = { width: overflow.width + 10, height: overflow.height };
  assert.deepEqual(frameOrigin({ origin: { x: 30, y: 1 } }, root, styles, unexplained), { x: 30, y: 1 });
  assert.deepEqual(frameOrigin({}, root, styles, unexplained), { x: 18.5, y: 1 });
});

test('reads a zip of a folder package, as Finder compresses one', () => {
  const finder = zip([
    { name: 'Cards.sketchframe/', data: new Uint8Array() },
    { name: 'Cards.sketchframe/design.json', data: readFileSync(join(fixture, 'design.json')) },
    { name: 'Cards.sketchframe/preview@2x.png', data: readFileSync(join(fixture, 'preview@2x.png')) },
    { name: '__MACOSX/Cards.sketchframe/._design.json', data: new Uint8Array(4) },
  ]);
  const entries = readArchive(finder);
  assert.deepEqual([...entries.keys()].sort(), ['design.json', 'preview@2x.png']);
});

test('updates one entry and keeps the rest', () => {
  const bytes = archiveOfFixture();
  const updated = updateArchive(bytes, { 'annotations.json': null });
  const files = Object.fromEntries(unzip(updated).map(({ name, data }) => [name, data]));
  assert.equal(files['annotations.json'], undefined);
  assert.deepEqual(files['preview@2x.png'], new Uint8Array(readFileSync(join(fixture, 'preview@2x.png'))));
  assert.ok(hasSketchframeMimetype(updated));
});

test('finds nodes by id, sketchId, path and unique name', () => {
  const frame = openSketchframe(fixture);
  assert.equal(findNode(frame, 'n4')?.name, 'Inner');
  assert.equal(findNode(frame, '33333333')?.id, 'n4');
  assert.equal(findNode(frame, 'Tilted/Inner')?.id, 'n4');
  assert.equal(findNode(frame, '/Tilted/Inner/')?.id, 'n4');
  assert.equal(findNode(frame, 'Inner')?.id, 'n4');
  assert.equal(findNode(frame, '/')?.id, 'n1');
  // "Label" is in the frame and in the Badge component.
  assert.throws(() => requireNode(frame, 'Label'), /2 layers are named "Label" \(n6, n8\)/);
  assert.throws(() => requireNode(frame, 'Nope'), /No layer matches/);
});

test('bounds follow rotation', () => {
  const frame = openSketchframe(fixture);
  // An 80×40 group at 100,50 rotated 90° about its centre (140,70).
  assert.deepEqual(bounds(requireNode(frame, 'n3')), { x: 120, y: 30, width: 40, height: 80 });
});

test('outlines with components, rotation, text and notes', () => {
  const frame = openSketchframe(fixture);
  const lines = outline(frame).split('\n');
  assert.equal(lines[0], 'Cards [frame] 200×150 n1');
  assert.equal(lines[1], '  Card [rectangle] 20,20 60×40 n2  ✎1');
  assert.equal(lines[2], '  Tilted [group] 100,50 80×40 n3  ↻90°');
  assert.equal(lines[4], '  Badge [instance] 20,100 40×20 n5  ◆ Badge  ✎1');
  assert.equal(lines[5], '    Label [text] 4,2 32×16 n6  "New"');
  assert.deepEqual(outline(frame, frame.root, { depth: 0 }).split('\n'), ['Cards [frame] 200×150 n1', '  … 5 more']);
});

test('node context resolves styles and tokens and attaches annotations', () => {
  const frame = openSketchframe(fixture);
  const context = nodeContext(frame, requireNode(frame, 'n2')) as any;
  assert.deepEqual(context.node.fills, [{ type: 'solid', color: '#ffffff', token: 'Neutral/White' }]);
  assert.deepEqual(context.tokens, { 'Neutral/White': '#ffffff' });
  assert.deepEqual(context.reusedStyles, ['fill_aaaa0001']);
  assert.deepEqual(context.sharedStyles, ['Surface']);
  assert.equal(context.annotations[0].id, 'A1');
  assert.equal(context.where, 'frame');

  const component = nodeContext(frame, requireNode(frame, 'n7')) as any;
  assert.equal(component.where, 'component definition');
  assert.equal(component.bounds, undefined);

  const shallow = nodeContext(frame, frame.root, { depth: 0 }) as any;
  assert.match(shallow.node.children, /3 children omitted/);
});

test('annotations re-attach by sketchId, path, then node id', () => {
  const frame = openSketchframe(fixture);
  assert.deepEqual(
    frame.annotations.map((annotation) => nodeForAnnotation(frame, annotation)?.id),
    ['n2', 'n4', 'n5', undefined],
  );
  const list = annotations(frame) as any[];
  assert.equal(list[3].layer.detached, true);
  assert.equal(list[2].category, 'content');
});

test('tokens list values and users', () => {
  const frame = openSketchframe(fixture);
  const result = tokens(frame) as any;
  assert.deepEqual(result.colors['Neutral/White'], { value: '#ffffff', usedBy: ['n2', 'n4'] });
  assert.deepEqual(result.colors['Brand/Blue'].usedBy, ['n1']);
  assert.deepEqual(result.sharedStyles.Surface.usedBy, ['n2']);
});

test('crops a node out of the preview, offset by the frame origin', () => {
  const frame = openSketchframe(fixture);
  // Card is 60×40 at 20,20; the frame starts 24,16 into the preview at 2x.
  assert.deepEqual(previewRegion(frame, requireNode(frame, 'n2')), { x: 88, y: 72, width: 120, height: 80 });
  assert.deepEqual(previewRegion(frame, requireNode(frame, 'n2'), 4), { x: 80, y: 64, width: 136, height: 96 });
  const crop = cropPreview(frame, requireNode(frame, 'n2'));
  const header = pngHeader(crop.png);
  assert.equal(header.width, 120);
  assert.equal(header.height, 80);
  const whole = cropPreview(frame);
  assert.deepEqual(whole.region, { x: 0, y: 0, width: 496, height: 396 });
});

test('generates HTML with token variables', () => {
  const frame = openSketchframe(fixture);
  const html = htmlForNode(frame, frame.root);
  assert.match(html, /--brand-blue: #3b5bdb/);
  assert.match(html, /background: var\(--brand-blue, #3b5bdb\)/);
  assert.match(html, /transform: rotate\(90deg\)/);
  assert.match(html, /<p class="label"[^>]*>New<\/p>/);
});

/** The fixture with one more vector, `Icon/Close`, that the exporter couldn't turn into SVG. */
function fixtureWithMissingVector(listed = true, name = 'Icon/Close', edit?: (design: any) => void) {
  const files = folderFiles(fixture);
  const design = JSON.parse(new TextDecoder().decode(files.read('design.json')!));
  design.root.children.push({ id: 'n9', name, type: 'vector', x: 176, y: 8, width: 16, height: 16 });
  if (listed) design.missingAssets = [{ id: 'n9', name }];
  edit?.(design);
  const entries = new Map(files.paths().map((path) => [path, files.read(path)!]));
  entries.set('design.json', strToU8(JSON.stringify(design)));
  return loadSketchframe(archiveFiles(writeArchive(entries)));
}

test('outline, node context and HTML say when a vector is missing', () => {
  const frame = fixtureWithMissingVector();
  assert.deepEqual(frame.missingAssets, [{ id: 'n9', name: 'Icon/Close' }]);

  const header = summary(frame);
  assert.match(header, /1 vector couldn't be exported \(Icon\/Close \(n9\)\); rebuild it from the preview or ask for the asset\./);
  assert.match(outline(frame), /Icon\/Close \[vector\] 176,8 16×16 n9  ⚠ asset missing/);

  const context = nodeContext(frame, requireNode(frame, 'n9'));
  assert.equal((context.missingAssets as { id: string }[])[0].id, 'n9');
  // The frame's own context lists it too, since it's in the subtree.
  assert.deepEqual(
    (nodeContext(frame, frame.root).missingAssets as { id: string }[]).map((asset) => asset.id),
    ['n9'],
  );
  assert.equal(nodeContext(frame, requireNode(frame, 'n2')).missingAssets, undefined);

  const html = htmlForNode(frame, frame.root);
  assert.match(html, /<!-- vector "Icon\/Close" \(n9\) couldn't be exported; rebuild it from the preview or ask for the asset -->/);
  assert.match(html, /<div class="icon-close" data-name="Icon\/Close" data-missing-asset><\/div>/);
});

test("a layer name can't close the missing-asset comment early", () => {
  for (const name of ['-->', '--->', 'a--->b', 'x-', '--!>', '<!-- hi -->', '----<script>alert(1)</script>']) {
    const frame = fixtureWithMissingVector(true, name);
    // Rendered from the frame and from the vector itself, whose name then
    // heads the output too.
    for (const html of [htmlForNode(frame, frame.root), htmlForNode(frame, requireNode(frame, 'n9'))]) {
      const comments = html.split('\n').filter((each) => each.trim().startsWith('<!--'));
      assert.equal(comments.length, 2, html);
      for (const line of comments) {
        assert.ok(line.trim().endsWith('-->'), line);
        assert.doesNotMatch(line.trim().slice('<!--'.length, -'-->'.length), /--|<|>/, `${JSON.stringify(name)} → ${line}`);
      }
      assert.equal(html.match(/-->/g)!.length, 2, `${JSON.stringify(name)} → ${html}`);
    }
  }
  // The id is escaped the same way.
  const frame = fixtureWithMissingVector(true, 'Icon', (design) => {
    design.root.children.at(-1).id = 'n9-->';
    design.missingAssets = [{ id: 'n9-->', name: 'Icon' }];
  });
  const html = htmlForNode(frame, frame.root);
  assert.match(html, /\(n9- -&gt;\) couldn't be exported/);
  assert.equal(html.match(/-->/g)!.length, 2);
});

test('the summary counts only the vectors the outline marks missing', () => {
  const frame = fixtureWithMissingVector(true, 'Icon/Close', (design) => {
    // n2 is listed but has a src; n404 isn't in the tree.
    design.missingAssets.push({ id: 'n404', name: 'Gone' });
    const withSrc = design.root.children.find((each: { id: string }) => each.id === 'n9');
    design.root.children.push({ ...withSrc, id: 'n10', name: 'Icon/Open', src: 'assets/open.svg' });
    design.missingAssets.push({ id: 'n10', name: 'Icon/Open' });
  });
  assert.match(summary(frame), /1 vector couldn't be exported \(Icon\/Close \(n9\)\); rebuild it/);
  assert.equal(outline(frame).match(/asset missing/g)!.length, 1);
});

test('exports without missingAssets read as before', () => {
  const frame = openSketchframe(fixture);
  assert.deepEqual(frame.missingAssets, []);
  assert.doesNotMatch(summary(frame), /couldn't be exported/);
  assert.doesNotMatch(outline(frame), /asset missing/);
  assert.equal(nodeContext(frame, frame.root).missingAssets, undefined);

  // An unlisted vector without a src stays an ordinary empty box.
  const unlisted = fixtureWithMissingVector(false);
  assert.doesNotMatch(summary(unlisted), /couldn't be exported/);
  assert.doesNotMatch(outline(unlisted), /asset missing/);
  assert.doesNotMatch(htmlForNode(unlisted, unlisted.root), /couldn't be exported|data-missing-asset/);
});

test('cat renders a stable text form without exportedAt', () => {
  const dir = scratch();
  try {
    const design = JSON.parse(readFileSync(join(fixture, 'design.json'), 'utf8'));
    design.exportedAt = '2026-11-06T00:00:00.000Z';
    const text = catText(archiveFiles(writeArchive({ 'design.json': JSON.stringify(design) })));
    assert.doesNotMatch(text, /exportedAt/);
    assert.match(text, /## design\.json/);
    assert.match(text, /^# Sketchframe \(archive\)/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('extracts, packs and saves annotations in both forms', () => {
  const dir = scratch();
  try {
    const archive = join(dir, 'Cards.sketchframe');
    pack(fixture, archive);
    assert.ok(hasSketchframeMimetype(new Uint8Array(readFileSync(archive))));

    const out = join(dir, 'out');
    assert.deepEqual(extract(archive, out), ['annotations.json', 'design.json', 'preview@2x.png']);
    assert.deepEqual(readFileSync(join(out, 'design.json')), readFileSync(join(fixture, 'design.json')));

    const frame = openSketchframe(archive);
    saveAnnotations(archive, frame.annotations.slice(0, 1));
    assert.equal(openSketchframe(archive).annotations.length, 1);
    saveAnnotations(archive, []);
    assert.ok(!unzip(new Uint8Array(readFileSync(archive))).some(({ name }) => name === 'annotations.json'));

    const folder = join(dir, 'Folder.sketchframe');
    cpSync(fixture, folder, { recursive: true });
    saveAnnotations(folder, []);
    assert.equal(existsSync(join(folder, 'annotations.json')), false);

    writeFileSync(join(dir, 'not-a-sketchframe.txt'), 'x');
    assert.deepEqual(findSketchframes(dir), ['Cards.sketchframe', 'Folder.sketchframe']);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('every tool runs against an archive', () => {
  const dir = scratch();
  try {
    const archive = join(dir, 'Cards.sketchframe');
    pack(fixture, archive);
    for (const tool of tools) {
      const args: Record<string, unknown> = { file: 'Cards.sketchframe', node: 'n2' };
      const content = tool.run(args, dir);
      assert.ok(content.length > 0, tool.name);
    }
    const [image] = toolNamed('get_screenshot')!.run({ file: archive }, dir);
    assert.equal(image.type, 'image');
    assert.throws(() => toolNamed('get_node')!.run({ file: archive }, dir), /Missing "node"/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('crops PNGs of every non-interlaced pixel format', () => {
  // A 5×3 image whose pixel (x, y) is (x*40, y*80, 7, 255), written with
  // every filter type, so unfiltering is exercised.
  const make = (colorType: number, bitDepth: number, pixel: (x: number, y: number) => number[]) => {
    const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
    const bits = channels * bitDepth;
    const stride = Math.ceil((5 * bits) / 8);
    const raw: number[] = [];
    for (let y = 0; y < 3; y++) {
      const line = new Uint8Array(stride);
      for (let x = 0; x < 5; x++) {
        const values = pixel(x, y);
        if (bits % 8 === 0) values.forEach((v, c) => (line[x * channels + c] = v));
        else for (let b = 0; b < bits; b++) if ((values[0] >> (bits - 1 - b)) & 1) line[(x * bits + b) >> 3] |= 0x80 >> ((x * bits + b) & 7);
      }
      raw.push(0, ...line); // filter none; cropPNG re-encodes, and is decoded again below
    }
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, 5);
    new DataView(ihdr.buffer).setUint32(4, 3);
    ihdr.set([bitDepth, colorType, 0, 0, 0], 8);
    return buildPNG(ihdr, new Uint8Array(raw), colorType === 3 ? new Uint8Array(48) : undefined);
  };
  const rgba = make(6, 8, (x, y) => [x * 40, y * 80, 7, 255]);
  const cropped = cropPNG(rgba, 1, 1, 3, 2);
  assert.deepEqual(pngHeader(cropped), { width: 3, height: 2, bitDepth: 8, colorType: 6, interlace: 0 });
  assert.deepEqual(decodeRows(cropped), [
    [40, 80, 7, 255, 80, 80, 7, 255, 120, 80, 7, 255],
    [40, 160, 7, 255, 80, 160, 7, 255, 120, 160, 7, 255],
  ]);
  // 2-bit palette: pixel x has index x % 4.
  const palette = make(3, 2, (x) => [x % 4]);
  assert.deepEqual(decodeRows(cropPNG(palette, 1, 0, 3, 1)), [[0b01101100]]);
  assert.throws(() => cropPNG(rgba, 4, 0, 2, 1), /outside the image/);
});

function buildPNG(ihdr: Uint8Array, raw: Uint8Array, plte?: Uint8Array): Uint8Array {
  const { deflateSync } = require('node:zlib') as typeof import('node:zlib');
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    new DataView(out.buffer).setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)];
  if (plte) parts.push(chunk('PLTE', plte));
  parts.push(chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array()));
  return new Uint8Array(Buffer.concat(parts));
}

/** Rows of a filter-type-0 PNG (what cropPNG writes), without the filter bytes. */
function decodeRows(png: Uint8Array): number[][] {
  const { inflateSync } = require('node:zlib') as typeof import('node:zlib');
  const { width, height, bitDepth, colorType } = pngHeader(png);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  let offset = 8;
  const view = new DataView(png.buffer, png.byteOffset);
  const idat: Uint8Array[] = [];
  while (offset < png.length) {
    const length = view.getUint32(offset);
    if (String.fromCharCode(...png.subarray(offset + 4, offset + 8)) === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return Array.from({ length: height }, (_, row) => [...raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1))]);
}
