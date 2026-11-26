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
// A design.json that won't parse gives no `rootSketchId`, so there's no
// telling which frame the file came from: its annotations are dropped, and
// that's reported (and, before writing, asked about), rather than kept on a
// design they may not describe.
export function parseExisting(files = {}) {
  return { rootSketchId: rootSketchId(files[DESIGN_FILE]), annotations: files[ANNOTATIONS_FILE] };
}

// Stands in for `parseExisting`'s result when a file exists but couldn't be
// read at all (a truncated archive, a damaged zip directory, something that
// isn't a Sketchframe). Distinct from {}, which means there's no file.
export const UNREADABLE = Object.freeze({ unreadable: true });

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

// Why annotations weren't kept: the file came from another frame, or it (or
// its design.json) can't be read, so there's no telling which frame it's from.
export const DIFFERENT_FRAME = "different-frame";
export const UNREADABLE_FILE = "unreadable";

// The one decision both export modes, and writePackage, make about the file a
// frame is about to replace.
//
// Annotations point at layers by `sketchId`, so they're kept only when the
// existing file was exported from the same frame. Carried into a different
// frame's export they would describe a design that isn't there.
//
// `annotationsDropped` is true when there were (or may have been) annotations
// and they weren't kept, and `reason` then says why. A file that couldn't be
// read at all counts as a possible drop: what was in it is user data we can't
// vouch for. `existing` is `parseExisting`'s result, UNREADABLE, or {} (or
// undefined) when there's no file.
export function carryOverAnnotations(existing, newRootSketchId) {
  if (existing && existing.unreadable) {
    return { annotations: undefined, annotationsDropped: true, reason: UNREADABLE_FILE };
  }
  const { rootSketchId: oldRootSketchId, annotations } = existing || {};
  const sameFrame = Boolean(oldRootSketchId) && oldRootSketchId === newRootSketchId;
  const annotationsDropped = hasAnnotations(annotations) && !sameFrame;
  return {
    annotations: sameFrame && annotations ? annotations : undefined,
    annotationsDropped,
    reason: annotationsDropped ? (oldRootSketchId ? DIFFERENT_FRAME : UNREADABLE_FILE) : undefined,
  };
}

// Why a set of files lost their annotations, as a clause that follows "it" or
// "they": "was exported from a different frame", "can't be read", or, for a
// mix, "isn't from this frame, or can't be read". `reasons` are
// carryOverAnnotations' `reason`s for the files.
export function droppedBecause(reasons, plural = false) {
  const unreadable = reasons.some((reason) => reason === UNREADABLE_FILE);
  const different = reasons.some((reason) => reason !== UNREADABLE_FILE);
  if (unreadable && different) return plural ? "aren't from these frames, or can't be read" : "isn't from this frame, or can't be read";
  if (unreadable) return "can't be read";
  return plural ? "were exported from different frames" : "was exported from a different frame";
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
