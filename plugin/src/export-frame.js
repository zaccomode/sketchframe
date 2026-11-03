import sketch from "sketch";
import { exportFrame } from "./export";
import { writePackage } from "./package-writer";

const NSModalResponseOK = 1;

export default function () {
  const document = sketch.getSelectedDocument();
  if (!document) {
    sketch.UI.message("No document open.");
    return;
  }

  const layers = document.selectedLayers.layers;
  if (layers.length !== 1) {
    sketch.UI.message("Select a single frame to export.");
    return;
  }
  const layer = layers[0];

  const destination = chooseDestination(layer.name);
  if (!destination) return;

  try {
    // Sketch 2026.2+ batches layout updates; flush them so geometry is current.
    if (typeof document.processPendingChanges === "function") {
      document.processPendingChanges();
    }
    const result = exportFrame(layer);
    writePackage(destination, result);
    sketch.UI.message(`Exported “${layer.name}”`);
    NSWorkspace.sharedWorkspace().activateFileViewerSelectingURLs([
      NSURL.fileURLWithPath(destination),
    ]);
  } catch (e) {
    console.error(e);
    sketch.UI.alert("Sketchframe export failed", String((e && e.stack) || e));
  }
}

function chooseDestination(name) {
  const panel = NSSavePanel.savePanel();
  panel.setTitle("Export Sketchframe");
  panel.setNameFieldStringValue(`${safeFileName(name)}.sketchframe`);
  panel.setAllowedFileTypes(["sketchframe"]);
  panel.setCanCreateDirectories(true);
  panel.setExtensionHidden(false);
  if (panel.runModal() != NSModalResponseOK) return null;
  return String(panel.URL().path());
}

function safeFileName(name) {
  return String(name).replace(/[/:]/g, "-").trim() || "Frame";
}
