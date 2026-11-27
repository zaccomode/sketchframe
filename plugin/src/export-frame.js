import sketch from "sketch";
import { exportFrame } from "./export";
import { existingFiles, writePackage } from "./package-writer";
import { carryOverAnnotations, droppedBecause, hasAnnotations } from "./annotations";
import { assignFileNames, isNumberedName, safeFileName } from "./file-names";
import { hash } from "./utils/hash";

const NSModalResponseOK = 1;
const NSAlertFirstButtonReturn = 1000;
const EXTENSION = "sketchframe";

export default function () {
  const document = sketch.getSelectedDocument();
  if (!document) {
    sketch.UI.message("No document open.");
    return;
  }

  const layers = document.selectedLayers.layers;
  if (!layers.length) {
    sketch.UI.message("Select one or more frames to export.");
    return;
  }

  // Each existing file is read once, and that one reading decides the alerts
  // and what writePackage keeps.
  const existing = existingFiles();
  const destinations = layers.length === 1 ? chooseFile(layers[0], existing) : chooseFolder(layers, existing);
  if (!destinations) return;

  // Sketch 2026.2+ batches layout updates; flush them so geometry is current.
  if (typeof document.processPendingChanges === "function") {
    document.processPendingChanges();
  }

  const written = [];
  const failures = [];
  const missing = [];
  const annotationsDropped = [];
  layers.forEach((layer, index) => {
    try {
      const result = exportFrame(layer);
      const outcome = writePackage(destinations[index], result, existing(destinations[index]));
      written.push(destinations[index]);
      if (outcome && outcome.annotationsDropped) {
        annotationsDropped.push({ name: fileName(destinations[index]), reason: outcome.reason });
      }
      (result.design.missingAssets || []).forEach((asset) => missing.push(asset));
    } catch (e) {
      console.error(e);
      failures.push({ name: layer.name, error: e });
    }
  });

  if (written.length) {
    NSWorkspace.sharedWorkspace().activateFileViewerSelectingURLs(
      written.map((filePath) => NSURL.fileURLWithPath(filePath))
    );
  }

  if (layers.length === 1) {
    if (failures.length) {
      const e = failures[0].error;
      sketch.UI.alert("Sketchframe export failed", String((e && e.stack) || e));
    } else {
      sketch.UI.message(`Exported “${layers[0].name}”${missingNote(missing)}${droppedNote(annotationsDropped)}`);
    }
    return;
  }

  // One failing frame shouldn't cost the others, so failures are collected
  // and reported together once everything else has been written.
  if (failures.length) {
    const details = failures
      .map(({ name, error }) => `“${name}”: ${String((error && error.message) || error)}`)
      .join("\n\n");
    sketch.UI.alert(
      `Sketchframe exported ${written.length} of ${layers.length} frames`,
      `${failures.length === 1 ? "This frame" : "These frames"} couldn't be exported:\n\n${details}` +
        (annotationsDropped.length ? `\n\n${droppedSentence(annotationsDropped)}` : "")
    );
    return;
  }
  sketch.UI.message(`Exported ${written.length} frames${missingNote(missing)}${droppedNote(annotationsDropped)}`);
}

// Annotations aren't carried into a file that was exported from a different
// frame, or that can't be read (see carryOverAnnotations), so say which files
// lost theirs. `dropped` is [{ name, reason }].
function droppedNote(dropped) {
  return dropped.length ? `. ${droppedSentence(dropped)}` : "";
}

function droppedSentence(dropped) {
  const names = dropped.slice(0, 3).map(({ name }) => `“${name}”`);
  if (dropped.length > 3) names.push(`and ${dropped.length - 3} more`);
  const one = dropped.length === 1;
  const because = droppedBecause(
    dropped.map(({ reason }) => reason),
    !one
  );
  return `The existing ${names.join(", ")} ${because}, so ${one ? "its" : "their"} annotations weren't kept.`;
}

function fileName(filePath) {
  return String(filePath).split("/").pop();
}

// " (2 vectors couldn't be exported: Icon/Close, Logo)", or "" if none were missed.
function missingNote(missing) {
  if (!missing || !missing.length) return "";
  const count = missing.length === 1 ? "1 vector couldn't" : `${missing.length} vectors couldn't`;
  const names = missing.slice(0, 3).map((asset) => asset.name);
  if (missing.length > 3) names.push("…");
  return ` (${count} be exported: ${names.join(", ")})`;
}

// One frame: a save panel, which names the file and confirms replacing one.
// Its "Replace?" prompt can't say that annotations will be lost, so when the
// file it's replacing would lose some (see carryOverAnnotations), ask again.
function chooseFile(layer, existing) {
  const panel = NSSavePanel.savePanel();
  panel.setTitle("Export Sketchframe");
  panel.setNameFieldStringValue(`${safeFileName(layer.name)}.${EXTENSION}`);
  panel.setAllowedFileTypes([EXTENSION]);
  panel.setCanCreateDirectories(true);
  panel.setExtensionHidden(false);
  if (panel.runModal() != NSModalResponseOK) return null;
  const filePath = String(panel.URL().path());
  const outcome = carryOverAnnotations(existing(filePath), frameSketchId(layer));
  if (outcome.annotationsDropped && !confirmDropAnnotations(fileName(filePath), outcome.reason)) return null;
  return [filePath];
}

function confirmDropAnnotations(name, reason) {
  const alert = NSAlert.alloc().init();
  alert.setMessageText(`Replace “${name}” and lose its annotations?`);
  alert.setInformativeText(
    `It ${droppedBecause([reason])}, so any annotations in it won't be kept. They can't be recovered after it's replaced.`
  );
  alert.addButtonWithTitle("Replace");
  alert.addButtonWithTitle("Cancel");
  return alert.runModal() == NSAlertFirstButtonReturn;
}

// Several frames: a folder, with each frame written to it under its own name.
// Returns a path per layer, in the same order, or null if cancelled.
function chooseFolder(layers, existing) {
  const panel = NSOpenPanel.openPanel();
  panel.setTitle(`Export ${layers.length} Sketchframes`);
  panel.setMessage(`Choose a folder for the ${layers.length} selected frames. Each is saved as its own .${EXTENSION}.`);
  panel.setPrompt("Export");
  panel.setCanChooseFiles(false);
  panel.setCanChooseDirectories(true);
  panel.setCanCreateDirectories(true);
  panel.setAllowsMultipleSelection(false);
  if (panel.runModal() != NSModalResponseOK) return null;
  const folder = String(panel.URL().path());

  const names = folderFileNames(folder, layers, existing);
  const paths = names.map((name) => `${folder}/${name}.${EXTENSION}`);

  // The open panel, unlike the save panel, doesn't ask before replacing.
  const fileManager = NSFileManager.defaultManager();
  const replacing = [];
  names.forEach((name, index) => {
    if (!fileManager.fileExistsAtPath(paths[index])) return;
    replacing.push(Object.assign({ name }, carryOverAnnotations(existing(paths[index]), frameSketchId(layers[index]))));
  });
  if (replacing.length && !confirmReplace(replacing)) return null;
  return paths;
}

// The `sketchId` the frame's root node gets in design.json (see walker.js).
function frameSketchId(layer) {
  return hash(String(layer.id));
}

// A file name per layer; see assignFileNames.
function folderFileNames(folder, layers, existing) {
  const frames = layers.map((layer) => ({ base: safeFileName(layer.name), sketchId: frameSketchId(layer) }));
  const previous = previousFileNames(
    folder,
    frames.map(({ base }) => base),
    existing
  );
  return assignFileNames(frames, previous);
}

// Root `sketchId` → base file name, for the Sketchframes already in the folder
// that one of these frames could have been written to.
function previousFileNames(folder, bases, existing) {
  const found = {};
  const contents = NSFileManager.defaultManager().contentsOfDirectoryAtPath_error(folder, null);
  if (!contents) return found;
  const suffix = `.${EXTENSION}`;
  for (let i = 0; i < contents.count(); i++) {
    const file = String(contents.objectAtIndex(i));
    if (!file.toLowerCase().endsWith(suffix)) continue;
    const base = file.slice(0, -suffix.length);
    if (!bases.some((candidate) => isNumberedName(base, candidate))) continue;
    const sketchId = existing(`${folder}/${file}`).rootSketchId;
    if (sketchId && !Object.prototype.hasOwnProperty.call(found, sketchId)) found[sketchId] = base;
  }
  return found;
}

// `existing` is [{ name, annotations, annotationsDropped, reason }]: each file
// being replaced, with carryOverAnnotations' decision for it.
function confirmReplace(existing) {
  const alert = NSAlert.alloc().init();
  const listed = existing.slice(0, 5).map(({ name }) => `${name}.${EXTENSION}`);
  if (existing.length > 5) listed.push(`and ${existing.length - 5} more`);
  alert.setMessageText(
    existing.length === 1
      ? `“${existing[0].name}.${EXTENSION}” already exists. Replace it?`
      : `${existing.length} of these Sketchframes already exist. Replace them?`
  );
  const note = annotationsNote(existing);
  alert.setInformativeText(`${existing.length === 1 ? "" : `${listed.join("\n")}${note ? "\n\n" : ""}`}${note}`);
  alert.addButtonWithTitle("Replace");
  alert.addButtonWithTitle("Cancel");
  return alert.runModal() == NSAlertFirstButtonReturn;
}

// What replacing does to annotations, by the same decision single-frame
// export and writePackage make. Files with none to lose aren't mentioned, and
// if no file has any, there's nothing to say.
function annotationsNote(existing) {
  const lost = existing.filter(({ annotationsDropped }) => annotationsDropped);
  if (!lost.length) {
    if (!existing.some(({ annotations }) => hasAnnotations(annotations))) return "";
    return existing.length === 1 ? "Annotations in the existing file are kept." : "Annotations in the existing files are kept.";
  }
  const reasons = lost.map(({ reason }) => reason);
  if (existing.length === 1) return `It ${droppedBecause(reasons)}, so any annotations in it won't be kept.`;
  const names = lost.slice(0, 5).map(({ name }) => `${name}.${EXTENSION}`);
  if (lost.length > 5) names.push(`and ${lost.length - 5} more`);
  const one = lost.length === 1;
  return `Annotations in ${names.join(", ")} won't be kept: ${one ? "it" : "they"} ${droppedBecause(reasons, !one)}.`;
}
