import fs from "@skpm/fs";
import { Buffer } from "buffer";
import { strToU8, zipSync } from "fflate";
import { PREVIEW_FILE } from "./export";
import { ANNOTATIONS_FILE, DESIGN_FILE, carryOverAnnotations, parseExisting, readArchiveFiles } from "./annotations";

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
//
// Returns `{ annotationsDropped }`: true when the file being replaced had
// annotations but was exported from a different frame, so they weren't kept.
export function writePackage(packagePath, { design, preview, assets }) {
  const { annotations, annotationsDropped } = carryOverAnnotations(readExisting(packagePath), design.root.sketchId);

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
  return { annotationsDropped };
}

// The `sketchId` of the frame an existing Sketchframe was exported from, or
// undefined if there's no file there or it can't be read.
export function existingRootSketchId(packagePath) {
  return readExisting(packagePath, false).rootSketchId;
}

// Whether writing a frame whose root is `rootSketchId` to `packagePath` would
// drop annotations: the file there has some and came from a different frame.
export function wouldDropAnnotations(packagePath, rootSketchId) {
  return carryOverAnnotations(readExisting(packagePath), rootSketchId).annotationsDropped;
}

// Annotations are user-authored, so they survive a re-export of the same
// frame. The app re-attaches them to layers by `sketchId`. Reads them, and the
// root frame's `sketchId`, from an existing archive or an older folder package.
function readExisting(packagePath, withAnnotations = true) {
  if (!fs.existsSync(packagePath)) return {};
  try {
    const wanted = withAnnotations ? [DESIGN_FILE, ANNOTATIONS_FILE] : [DESIGN_FILE];
    let files = {};
    if (isDirectory(packagePath)) {
      wanted.forEach((name) => {
        const filePath = `${packagePath}/${name}`;
        if (fs.existsSync(filePath)) files[name] = fs.readFileSync(filePath, "utf8");
      });
    } else {
      files = readArchiveFiles(bytes(fs.readFileSync(packagePath)), wanted);
    }
    return parseExisting(files);
  } catch (e) {
    // Not something we can read (e.g. a file that isn't a Sketchframe); it's
    // being replaced either way.
    console.error(e);
    return {};
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
