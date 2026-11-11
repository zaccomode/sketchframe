import fs from "@skpm/fs";
import { Buffer } from "buffer";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PREVIEW_FILE } from "./export";

const DESIGN_FILE = "design.json";
const ANNOTATIONS_FILE = "annotations.json";
const MIMETYPE = "application/vnd.sketchframe+zip";
// Already compressed, so stored rather than deflated again.
const STORED_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "heic", "avif"];

// Writes a .sketchframe: a single-file zip archive (format v2, see
// docs/FORMAT.md). The first entry is an uncompressed `mimetype`, so tools can
// recognise the file from its first bytes, as EPUB and ODF do.
//
//   Name.sketchframe (zip)
//   ├── mimetype           application/vnd.sketchframe+zip, stored
//   ├── README.md
//   ├── design.json
//   ├── annotations.json   (written by the Sketchframe app; kept on re-export)
//   ├── preview@2x.png     stored
//   └── assets/
//
// packages/core/src/archive.ts writes the same layout for the CLI.
export function writePackage(packagePath, { design, preview, assets }) {
  const annotations = existingAnnotations(packagePath);

  const entries = [
    ["README.md", readme(design)],
    [DESIGN_FILE, JSON.stringify(design, null, 2)],
  ];
  if (annotations) entries.push([ANNOTATIONS_FILE, annotations]);
  entries.push([PREVIEW_FILE, preview]);
  Object.keys(assets)
    .sort()
    .forEach((assetPath) => entries.push([assetPath, assets[assetPath]]));

  // A fixed date keeps the bytes the same for the same contents.
  const mtime = new Date(2026, 0, 1);
  const zippable = { mimetype: [strToU8(MIMETYPE), { level: 0, mtime }] };
  entries.forEach(([name, value]) => {
    const data = typeof value === "string" ? strToU8(value) : bytes(value);
    const extension = name.split(".").pop().toLowerCase();
    zippable[name] = [data, { level: STORED_EXTENSIONS.indexOf(extension) >= 0 ? 0 : 6, mtime }];
  });
  const archive = zipSync(zippable);

  const fileManager = NSFileManager.defaultManager();
  // The save panel has already confirmed replacing what's there. An older
  // export is a folder, which writing a file over would fail on.
  if (fileManager.fileExistsAtPath(packagePath) && isDirectory(packagePath)) {
    fileManager.removeItemAtPath_error(packagePath, null);
  }
  fs.writeFileSync(packagePath, Buffer.from(archive.buffer, archive.byteOffset, archive.byteLength));
}

// Annotations are user-authored, so they survive a re-export. The app
// re-attaches them to layers by `sketchId`. Reads them from an existing
// archive, or from an older folder package.
function existingAnnotations(packagePath) {
  if (!fs.existsSync(packagePath)) return undefined;
  try {
    if (isDirectory(packagePath)) {
      const annotationsPath = `${packagePath}/${ANNOTATIONS_FILE}`;
      return fs.existsSync(annotationsPath) ? fs.readFileSync(annotationsPath, "utf8") : undefined;
    }
    const files = unzipSync(bytes(fs.readFileSync(packagePath)), {
      filter: (file) => file.name === ANNOTATIONS_FILE,
    });
    return files[ANNOTATIONS_FILE] ? strFromU8(files[ANNOTATIONS_FILE]) : undefined;
  } catch (e) {
    // Not something we can read (e.g. a file that isn't a Sketchframe); it's
    // being replaced either way.
    console.error(e);
    return undefined;
  }
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch (e) {
    return false;
  }
}

function bytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(Buffer.from(value));
}

// Lets an agent that unpacks the archive (rather than using the sketchframe
// tools) know how to read it.
function readme(design) {
  return `# ${design.name}

Exported from Sketch by sketchframe (format v${design.version}).

A .sketchframe is a zip archive. With the sketchframe tools
(\`npx sketchframe\`, or the MCP server \`npx sketchframe mcp\`), start with
\`sketchframe outline <file>\`. Without them:

    unzip -p Name.sketchframe design.json
    python3 -m zipfile -e Name.sketchframe out/

- \`${PREVIEW_FILE}\` — rendered image of the frame at ${design.preview.scale}x. Look at this first.
- \`${DESIGN_FILE}\` — the full layer tree. Start with \`outline\`, then read \`root\`.
  Positions are in points, relative to the parent node. Values in \`styles\` are
  referenced from nodes by key (e.g. \`"fills": "fill_9d1e44a0"\`).
- \`${ANNOTATIONS_FILE}\` (if present) — notes designers left on specific layers,
  each with a category (development, interaction, accessibility, content).
  \`nodeId\` / \`sketchId\` point at nodes in \`${DESIGN_FILE}\`. Follow these notes.
- \`assets/\` — images and SVGs referenced by \`src\` fields in \`${DESIGN_FILE}\`.
  Vectors Sketch couldn't export have no \`src\` and are listed in \`missingAssets\`.

Format: https://github.com/zaccomode/sketchframe/blob/main/docs/FORMAT.md
`;
}
