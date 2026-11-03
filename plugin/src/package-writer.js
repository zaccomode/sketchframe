import fs from "@skpm/fs";
import path from "path";
import { PREVIEW_FILE } from "./export";

const DESIGN_FILE = "design.json";
const ANNOTATIONS_FILE = "annotations.json";

// Writes a .sketchframe package (a directory Finder can show as one file):
//
//   Name.sketchframe/
//   ├── README.md
//   ├── design.json
//   ├── preview@2x.png
//   ├── annotations.json   (written by the Sketchframe app; kept on re-export)
//   └── assets/
export function writePackage(packagePath, { design, preview, assets }) {
  const fileManager = NSFileManager.defaultManager();
  let annotations;
  if (fileManager.fileExistsAtPath(packagePath)) {
    // Annotations are user-authored, so they survive a re-export. The app
    // re-attaches them to layers by `sketchId`.
    const annotationsPath = path.join(packagePath, ANNOTATIONS_FILE);
    if (fs.existsSync(annotationsPath)) annotations = fs.readFileSync(annotationsPath, "utf8");
    // The save panel has already confirmed replacing the existing package.
    fileManager.removeItemAtPath_error(packagePath, null);
  }

  fs.mkdirSync(packagePath);
  fs.writeFileSync(path.join(packagePath, "README.md"), readme(design));
  fs.writeFileSync(path.join(packagePath, DESIGN_FILE), JSON.stringify(design, null, 2));
  fs.writeFileSync(path.join(packagePath, PREVIEW_FILE), preview);
  if (annotations) fs.writeFileSync(path.join(packagePath, ANNOTATIONS_FILE), annotations);

  const assetPaths = Object.keys(assets);
  if (assetPaths.length) fs.mkdirSync(path.join(packagePath, "assets"));
  assetPaths.forEach((assetPath) => {
    fs.writeFileSync(path.join(packagePath, assetPath), assets[assetPath]);
  });
}

// Lets an agent that lands in the package (rather than being handed
// design.json directly) know how to read it.
function readme(design) {
  return `# ${design.name}

Exported from Sketch by sketchframe (format v${design.version}).

- \`${PREVIEW_FILE}\` — rendered image of the frame at ${design.preview.scale}x. Look at this first.
- \`${DESIGN_FILE}\` — the full layer tree. Start with \`outline\`, then read \`root\`.
  Positions are in points, relative to the parent node. Values in \`styles\` are
  referenced from nodes by key (e.g. \`"fills": "fill_9d1e44a0"\`).
- \`${ANNOTATIONS_FILE}\` (if present) — notes designers left on specific layers,
  each with a category (development, interaction, accessibility, content).
  \`nodeId\` / \`sketchId\` point at nodes in \`${DESIGN_FILE}\`. Follow these notes.
- \`assets/\` — images and SVGs referenced by \`src\` fields in \`${DESIGN_FILE}\`.
`;
}
