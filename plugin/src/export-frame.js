import sketch from "sketch";
import { exportFrame } from "./export";
import { writePackage } from "./package-writer";

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

  const destinations = layers.length === 1 ? chooseFile(layers[0].name) : chooseFolder(layers);
  if (!destinations) return;

  // Sketch 2026.2+ batches layout updates; flush them so geometry is current.
  if (typeof document.processPendingChanges === "function") {
    document.processPendingChanges();
  }

  const written = [];
  const failures = [];
  const missing = [];
  layers.forEach((layer, index) => {
    try {
      const result = exportFrame(layer);
      writePackage(destinations[index], result);
      written.push(destinations[index]);
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
      sketch.UI.message(`Exported “${layers[0].name}”${missingNote(missing)}`);
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
      `${failures.length === 1 ? "This frame" : "These frames"} couldn't be exported:\n\n${details}`
    );
    return;
  }
  sketch.UI.message(`Exported ${written.length} frames${missingNote(missing)}`);
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
function chooseFile(name) {
  const panel = NSSavePanel.savePanel();
  panel.setTitle("Export Sketchframe");
  panel.setNameFieldStringValue(`${safeFileName(name)}.${EXTENSION}`);
  panel.setAllowedFileTypes([EXTENSION]);
  panel.setCanCreateDirectories(true);
  panel.setExtensionHidden(false);
  if (panel.runModal() != NSModalResponseOK) return null;
  return [String(panel.URL().path())];
}

// Several frames: a folder, with each frame written to it under its own name.
// Returns a path per layer, in the same order, or null if cancelled.
function chooseFolder(layers) {
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

  const names = uniqueFileNames(layers.map((layer) => safeFileName(layer.name)));
  const paths = names.map((name) => `${folder}/${name}.${EXTENSION}`);

  // The open panel, unlike the save panel, doesn't ask before replacing.
  const fileManager = NSFileManager.defaultManager();
  const existing = names.filter((name, index) => fileManager.fileExistsAtPath(paths[index]));
  if (existing.length && !confirmReplace(existing)) return null;
  return paths;
}

// Frames often share a name ("Desktop", "Mobile" on several pages). Numbers
// the repeats, "Name 2", "Name 3", comparing without case as macOS does.
function uniqueFileNames(names) {
  const taken = {};
  names.forEach((name) => {
    taken[name.toLowerCase()] = true;
  });
  const seen = {};
  return names.map((name) => {
    const key = name.toLowerCase();
    if (!seen[key]) {
      seen[key] = true;
      return name;
    }
    let n = 2;
    while (taken[`${key} ${n}`]) n += 1;
    const unique = `${name} ${n}`;
    taken[unique.toLowerCase()] = true;
    return unique;
  });
}

function confirmReplace(existing) {
  const alert = NSAlert.alloc().init();
  const listed = existing.slice(0, 5).map((name) => `${name}.${EXTENSION}`);
  if (existing.length > 5) listed.push(`and ${existing.length - 5} more`);
  alert.setMessageText(
    existing.length === 1
      ? `“${existing[0]}.${EXTENSION}” already exists. Replace it?`
      : `${existing.length} of these Sketchframes already exist. Replace them?`
  );
  alert.setInformativeText(
    `${existing.length === 1 ? "" : `${listed.join("\n")}\n\n`}Annotations in the existing files are kept.`
  );
  alert.addButtonWithTitle("Replace");
  alert.addButtonWithTitle("Cancel");
  return alert.runModal() == NSAlertFirstButtonReturn;
}

function safeFileName(name) {
  return String(name).replace(/[/:]/g, "-").trim() || "Frame";
}
