// Whether a re-export keeps the annotations in the file it replaces. Kept free
// of Sketch and Cocoa APIs so it can be unit-tested in Node
// (plugin/test/annotations.test.mjs).
import { strFromU8, unzipSync } from "fflate";

export const DESIGN_FILE = "design.json";
export const ANNOTATIONS_FILE = "annotations.json";

// What an existing Sketchframe holds that matters for a re-export, from its
// files (name → text) however they were read, archive or older folder
// package. Missing files are left out of `files`.
//
// A design.json that won't parse gives no `rootSketchId`, so the file counts
// as another frame's: its annotations are dropped, and that's reported (and,
// before writing, asked about), rather than kept on a design they may not
// describe.
export function parseExisting(files = {}) {
  return { rootSketchId: rootSketchId(files[DESIGN_FILE]), annotations: files[ANNOTATIONS_FILE] };
}

// The named files from a .sketchframe archive's bytes, as text.
export function readArchiveFiles(bytes, wanted) {
  const entries = unzipSync(bytes, { filter: (file) => wanted.indexOf(file.name) >= 0 });
  const files = {};
  Object.keys(entries).forEach((name) => {
    files[name] = strFromU8(entries[name]);
  });
  return files;
}

// The `sketchId` of the frame a design.json was exported from, or undefined if
// there's no design.json or it can't be read.
export function rootSketchId(designJSON) {
  if (!designJSON) return undefined;
  try {
    const design = JSON.parse(designJSON);
    const sketchId = design && design.root ? design.root.sketchId : undefined;
    return typeof sketchId === "string" && sketchId ? sketchId : undefined;
  } catch (e) {
    return undefined;
  }
}

// Annotations point at layers by `sketchId`, so they're kept only when the
// existing file was exported from the same frame. Carried into a different
// frame's export they would describe a design that isn't there.
// `annotationsDropped` is true when there were annotations and they weren't
// kept. `existing` is `parseExisting`'s result, or {} when there's no file or
// it can't be read.
export function carryOverAnnotations(existing, newRootSketchId) {
  const { rootSketchId: oldRootSketchId, annotations } = existing || {};
  const sameFrame = Boolean(oldRootSketchId) && oldRootSketchId === newRootSketchId;
  return {
    annotations: sameFrame && annotations ? annotations : undefined,
    annotationsDropped: hasAnnotations(annotations) && !sameFrame,
  };
}

// Whether an annotations.json holds any notes. One that won't parse counts as
// holding some: it's user data we can't vouch for, so losing it is reported.
export function hasAnnotations(annotationsJSON) {
  if (!annotationsJSON) return false;
  try {
    const parsed = JSON.parse(annotationsJSON);
    return !(parsed && Array.isArray(parsed.annotations) && parsed.annotations.length === 0);
  } catch (e) {
    return true;
  }
}
