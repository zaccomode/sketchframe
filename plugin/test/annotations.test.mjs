// Run with `npm test` in plugin/. Whether a re-export keeps the annotations in
// the file it replaces (see src/annotations.js and writePackage).
import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import {
  ANNOTATIONS_FILE,
  DESIGN_FILE,
  carryOverAnnotations,
  hasAnnotations,
  parseExisting,
  readArchiveFiles,
  rootSketchId,
} from "../src/annotations.js";

const design = (sketchId) => JSON.stringify({ version: 2, name: "Desktop", root: { sketchId } });
const notes = JSON.stringify({
  version: 1,
  annotations: [{ id: "1", category: "development", text: "Only the black fill", sketchId: "1a2b3c4d" }],
});
const noNotes = JSON.stringify({ version: 1, annotations: [] });

const existing = (files) => parseExisting(files);

test("same frame: annotations are kept and nothing is reported as dropped", () => {
  const result = carryOverAnnotations(existing({ [DESIGN_FILE]: design("aaaaaaaa"), [ANNOTATIONS_FILE]: notes }), "aaaaaaaa");
  assert.deepEqual(result, { annotations: notes, annotationsDropped: false });
});

test("different frame with annotations: they are dropped, and the drop is reported", () => {
  const result = carryOverAnnotations(existing({ [DESIGN_FILE]: design("aaaaaaaa"), [ANNOTATIONS_FILE]: notes }), "bbbbbbbb");
  assert.deepEqual(result, { annotations: undefined, annotationsDropped: true });
});

test("different frame with no annotations: nothing is reported", () => {
  assert.deepEqual(carryOverAnnotations(existing({ [DESIGN_FILE]: design("aaaaaaaa") }), "bbbbbbbb"), {
    annotations: undefined,
    annotationsDropped: false,
  });
  // An annotations.json whose list is empty has nothing to lose either.
  assert.deepEqual(
    carryOverAnnotations(existing({ [DESIGN_FILE]: design("aaaaaaaa"), [ANNOTATIONS_FILE]: noNotes }), "bbbbbbbb"),
    { annotations: undefined, annotationsDropped: false }
  );
});

test("same frame with an empty annotations list keeps the file as it is", () => {
  const result = carryOverAnnotations(existing({ [DESIGN_FILE]: design("aaaaaaaa"), [ANNOTATIONS_FILE]: noNotes }), "aaaaaaaa");
  assert.deepEqual(result, { annotations: noNotes, annotationsDropped: false });
});

test("existing file missing or unreadable: nothing is kept and nothing is reported", () => {
  // writePackage's reader returns {} for both: no file, or one it couldn't open.
  assert.deepEqual(carryOverAnnotations({}, "aaaaaaaa"), { annotations: undefined, annotationsDropped: false });
  assert.deepEqual(carryOverAnnotations(undefined, "aaaaaaaa"), { annotations: undefined, annotationsDropped: false });
  assert.deepEqual(carryOverAnnotations(existing({}), "aaaaaaaa"), { annotations: undefined, annotationsDropped: false });
});

test("design.json won't parse: annotations count as another frame's, so they're dropped and reported", () => {
  const parsed = existing({ [DESIGN_FILE]: "{ not json", [ANNOTATIONS_FILE]: notes });
  assert.equal(parsed.rootSketchId, undefined);
  assert.deepEqual(carryOverAnnotations(parsed, "aaaaaaaa"), { annotations: undefined, annotationsDropped: true });
});

test("design.json missing but annotations present: dropped and reported", () => {
  assert.deepEqual(carryOverAnnotations(existing({ [ANNOTATIONS_FILE]: notes }), "aaaaaaaa"), {
    annotations: undefined,
    annotationsDropped: true,
  });
});

test("a missing sketchId on either side never counts as the same frame", () => {
  const parsed = existing({ [DESIGN_FILE]: JSON.stringify({ root: {} }), [ANNOTATIONS_FILE]: notes });
  assert.deepEqual(carryOverAnnotations(parsed, undefined), { annotations: undefined, annotationsDropped: true });
});

test("an annotations.json that won't parse counts as holding notes", () => {
  assert.equal(hasAnnotations("{ not json"), true);
  assert.equal(hasAnnotations(notes), true);
  assert.equal(hasAnnotations(noNotes), false);
  assert.equal(hasAnnotations(undefined), false);
  assert.equal(hasAnnotations(""), false);
});

test("rootSketchId reads root.sketchId, or undefined", () => {
  assert.equal(rootSketchId(design("aaaaaaaa")), "aaaaaaaa");
  assert.equal(rootSketchId(undefined), undefined);
  assert.equal(rootSketchId(""), undefined);
  assert.equal(rootSketchId("{ not json"), undefined);
  assert.equal(rootSketchId("null"), undefined);
  assert.equal(rootSketchId(JSON.stringify({ root: null })), undefined);
  assert.equal(rootSketchId(JSON.stringify({ root: { sketchId: 42 } })), undefined);
});

test("readArchiveFiles reads only the wanted entries from an archive", () => {
  const archive = zipSync({
    mimetype: strToU8("application/vnd.sketchframe+zip"),
    [DESIGN_FILE]: strToU8(design("aaaaaaaa")),
    [ANNOTATIONS_FILE]: strToU8(notes),
    "preview@2x.png": new Uint8Array([1, 2, 3]),
  });
  assert.deepEqual(readArchiveFiles(archive, [DESIGN_FILE, ANNOTATIONS_FILE]), {
    [DESIGN_FILE]: design("aaaaaaaa"),
    [ANNOTATIONS_FILE]: notes,
  });
  assert.deepEqual(Object.keys(readArchiveFiles(archive, [DESIGN_FILE])), [DESIGN_FILE]);
});

test("readArchiveFiles on an archive without annotations, then carried over", () => {
  const archive = zipSync({ [DESIGN_FILE]: strToU8(design("aaaaaaaa")) });
  const parsed = parseExisting(readArchiveFiles(archive, [DESIGN_FILE, ANNOTATIONS_FILE]));
  assert.deepEqual(parsed, { rootSketchId: "aaaaaaaa", annotations: undefined });
  assert.deepEqual(carryOverAnnotations(parsed, "bbbbbbbb"), { annotations: undefined, annotationsDropped: false });
});

test("readArchiveFiles throws on bytes that aren't a zip (the reader treats that as unreadable)", () => {
  assert.throws(() => readArchiveFiles(new Uint8Array([1, 2, 3, 4]), [DESIGN_FILE]));
});

test("an older folder package's files parse the same way", () => {
  // The folder reader collects the same name → text map from disk.
  const parsed = parseExisting({ [DESIGN_FILE]: design("aaaaaaaa"), [ANNOTATIONS_FILE]: notes });
  assert.deepEqual(parsed, { rootSketchId: "aaaaaaaa", annotations: notes });
});
