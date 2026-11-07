import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { archiveFiles, hasSketchframeMimetype, text } from '../../packages/core/src/archive.ts';
import { parsePackage } from '../webview/model.ts';

// What the viewer does with an archive: read design.json and annotations.json
// out of it and parse them like a folder's.
test('the archive fixture reads like the folder fixture', () => {
  const bytes = new Uint8Array(readFileSync(new URL('fixtures/Cards Archive.sketchframe', import.meta.url)));
  assert.ok(hasSketchframeMimetype(bytes));
  const files = archiveFiles(bytes);
  const fromArchive = parsePackage(text(files, 'design.json') ?? '', text(files, 'annotations.json') ?? null);
  const folder = new URL('fixtures/Cards.sketchframe/', import.meta.url);
  const fromFolder = parsePackage(
    readFileSync(new URL('design.json', folder), 'utf8'),
    readFileSync(new URL('annotations.json', folder), 'utf8'),
  );
  assert.equal(fromArchive.nodeCount, fromFolder.nodeCount);
  assert.deepEqual(fromArchive.annotations, fromFolder.annotations);
  assert.ok(files.read(fromArchive.previewSrc));
});
