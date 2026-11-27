// Run with `npm test` in plugin/. Whether a re-export keeps the annotations in
// the file it replaces (see src/annotations.js and writePackage).
import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import {
  ANNOTATIONS_FILE,
  DESIGN_FILE,
  DIFFERENT_FRAME,
  UNREADABLE,
  UNREADABLE_FILE,
  carryOverAnnotations,
  droppedBecause,
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
  assert.deepEqual(result, { annotations: notes, annotationsDropped: false, reason: undefined });
});

test("different frame with annotations: they are dropped, and the drop is reported", () => {
  const result = carryOverAnnotations(existing({ [DESIGN_FILE]: design("aaaaaaaa"), [ANNOTATIONS_FILE]: notes }), "bbbbbbbb");
  assert.deepEqual(result, { annotations: undefined, annotationsDropped: true, reason: DIFFERENT_FRAME });
});

test("different frame with no annotations: nothing is reported", () => {
  assert.deepEqual(carryOverAnnotations(existing({ [DESIGN_FILE]: design("aaaaaaaa") }), "bbbbbbbb"), {
    annotations: undefined,
    annotationsDropped: false,
    reason: undefined,
  });
  // An annotations.json whose list is empty has nothing to lose either.
  assert.deepEqual(
    carryOverAnnotations(existing({ [DESIGN_FILE]: design("aaaaaaaa"), [ANNOTATIONS_FILE]: noNotes }), "bbbbbbbb"),
    { annotations: undefined, annotationsDropped: false, reason: undefined }
  );
});

test("same frame with an empty annotations list keeps the file as it is", () => {
  const result = carryOverAnnotations(existing({ [DESIGN_FILE]: design("aaaaaaaa"), [ANNOTATIONS_FILE]: noNotes }), "aaaaaaaa");
  assert.deepEqual(result, { annotations: noNotes, annotationsDropped: false, reason: undefined });
});

test("no existing file: nothing is kept and nothing is reported", () => {
  // readExisting returns {} when there's no file.
  assert.deepEqual(carryOverAnnotations({}, "aaaaaaaa"), { annotations: undefined, annotationsDropped: false, reason: undefined });
  assert.deepEqual(carryOverAnnotations(undefined, "aaaaaaaa"), { annotations: undefined, annotationsDropped: false, reason: undefined });
  assert.deepEqual(carryOverAnnotations(existing({}), "aaaaaaaa"), { annotations: undefined, annotationsDropped: false, reason: undefined });
});

test("design.json won't parse: there's no telling which frame, so annotations are dropped and reported as unreadable", () => {
  const parsed = existing({ [DESIGN_FILE]: "{ not json", [ANNOTATIONS_FILE]: notes });
  assert.equal(parsed.rootSketchId, undefined);
  assert.deepEqual(carryOverAnnotations(parsed, "aaaaaaaa"), {
    annotations: undefined,
    annotationsDropped: true,
    reason: UNREADABLE_FILE,
  });
});

test("design.json missing but annotations present: dropped and reported", () => {
  assert.deepEqual(carryOverAnnotations(existing({ [ANNOTATIONS_FILE]: notes }), "aaaaaaaa"), {
    annotations: undefined,
    annotationsDropped: true,
    reason: UNREADABLE_FILE,
  });
});

test("a missing sketchId on either side never counts as the same frame", () => {
  const parsed = existing({ [DESIGN_FILE]: JSON.stringify({ root: {} }), [ANNOTATIONS_FILE]: notes });
  assert.deepEqual(carryOverAnnotations(parsed, undefined), {
    annotations: undefined,
    annotationsDropped: true,
    reason: UNREADABLE_FILE,
  });
  // And a file whose frame is known still differs from a new frame without one.
  const known = existing({ [DESIGN_FILE]: design("aaaaaaaa"), [ANNOTATIONS_FILE]: notes });
  assert.equal(carryOverAnnotations(known, undefined).reason, DIFFERENT_FRAME);
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
  assert.deepEqual(carryOverAnnotations(parsed, "bbbbbbbb"), { annotations: undefined, annotationsDropped: false, reason: undefined });
});

test("readArchiveFiles throws on bytes that aren't a zip (the reader treats that as unreadable)", () => {
  assert.throws(() => readArchiveFiles(new Uint8Array([1, 2, 3, 4]), [DESIGN_FILE]));
});

test("an older folder package's files parse the same way", () => {
  // The folder reader collects the same name → text map from disk.
  const parsed = parseExisting({ [DESIGN_FILE]: design("aaaaaaaa"), [ANNOTATIONS_FILE]: notes });
  assert.deepEqual(parsed, { rootSketchId: "aaaaaaaa", annotations: notes });
});

test("an existing file that can't be read at all counts as a possible loss", () => {
  // readExisting returns UNREADABLE when opening the file throws, e.g. a
  // truncated archive. Whatever it held can't be vouched for.
  const expected = { annotations: undefined, annotationsDropped: true, reason: UNREADABLE_FILE };
  assert.deepEqual(carryOverAnnotations(UNREADABLE, "aaaaaaaa"), expected);
  assert.deepEqual(carryOverAnnotations(UNREADABLE, undefined), expected);
});

test("a truncated archive is unreadable, not missing", () => {
  const archive = zipSync({
    [DESIGN_FILE]: strToU8(design("aaaaaaaa")),
    [ANNOTATIONS_FILE]: strToU8(notes),
  });
  // Cutting off the end loses the zip's central directory, as `truncate` does.
  const truncated = archive.slice(0, Math.floor(archive.length / 2));
  assert.throws(() => readArchiveFiles(truncated, [DESIGN_FILE, ANNOTATIONS_FILE]));
});

test("both export modes and the writer share one decision for every kind of existing file", () => {
  // Single-frame (chooseFile), folder (confirmReplace) and writePackage all
  // call carryOverAnnotations on the same reading; this is the table they share.
  const cases = [
    // [existing, dropped, reason, kept]
    [{}, false, undefined, false],
    [UNREADABLE, true, UNREADABLE_FILE, false],
    [existing({ [DESIGN_FILE]: design("aaaaaaaa"), [ANNOTATIONS_FILE]: notes }), false, undefined, true],
    [existing({ [DESIGN_FILE]: design("bbbbbbbb"), [ANNOTATIONS_FILE]: notes }), true, DIFFERENT_FRAME, false],
    // Another frame's file with no annotations: nothing to warn about.
    [existing({ [DESIGN_FILE]: design("bbbbbbbb") }), false, undefined, false],
    [existing({ [DESIGN_FILE]: design("bbbbbbbb"), [ANNOTATIONS_FILE]: noNotes }), false, undefined, false],
    [existing({ [DESIGN_FILE]: "{ not json", [ANNOTATIONS_FILE]: notes }), true, UNREADABLE_FILE, false],
  ];
  cases.forEach(([state, dropped, reason, kept]) => {
    const result = carryOverAnnotations(state, "aaaaaaaa");
    assert.equal(result.annotationsDropped, dropped);
    assert.equal(result.reason, reason);
    assert.equal(Boolean(result.annotations), kept);
  });
});

test("droppedBecause words the reason to match it", () => {
  assert.equal(droppedBecause([DIFFERENT_FRAME]), "was exported from a different frame");
  assert.equal(droppedBecause([DIFFERENT_FRAME, DIFFERENT_FRAME], true), "were exported from different frames");
  assert.equal(droppedBecause([UNREADABLE_FILE]), "can't be read");
  assert.equal(droppedBecause([UNREADABLE_FILE, UNREADABLE_FILE], true), "can't be read");
  assert.equal(droppedBecause([DIFFERENT_FRAME, UNREADABLE_FILE], true), "aren't from these frames, or can't be read");
});
