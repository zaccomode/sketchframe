import fs from "@skpm/fs";
import { Buffer } from "buffer";
import { strToU8, zipSync } from "fflate";
import { PREVIEW_FILE } from "./export";
import { ANNOTATIONS_FILE, DESIGN_FILE, UNREADABLE, carryOverAnnotations, parseExisting, readArchiveFiles } from "./annotations";

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
// `existing` is what readExisting found at `packagePath`, read once when the
// export began so the alerts and this agree; it's read here if not given.
//
// Returns carryOverAnnotations' `{ annotationsDropped, reason }`: whether the
// file being replaced had (or may have had) annotations that weren't kept,
// and why.
export function writePackage(packagePath, { design, preview, assets }, existing = readExisting(packagePath)) {
  const { annotations, annotationsDropped, reason } = carryOverAnnotations(existing, design.root.sketchId);

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
  return { annotationsDropped, reason };
}

// A reader that opens each path at most once per export: choosing file names,
// the replace alerts and writePackage all ask about the same files.
export function existingFiles() {
  const read = {};
  return (packagePath) => {
    if (!Object.prototype.hasOwnProperty.call(read, packagePath)) read[packagePath] = readExisting(packagePath);
    return read[packagePath];
  };
}

// Annotations are user-authored, so they survive a re-export of the same
// frame. The app re-attaches them to layers by `sketchId`. Reads them, and the
// root frame's `sketchId`, from an existing archive or an older folder package.
// Returns {} when there's no file, and UNREADABLE when there's one that can't
// be read, which carryOverAnnotations treats as a possible loss.
export function readExisting(packagePath) {
  if (!fs.existsSync(packagePath)) return {};
  try {
    const wanted = [DESIGN_FILE, ANNOTATIONS_FILE];
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
    // A truncated or damaged archive, or a file that isn't a Sketchframe. It's
    // replaced either way, but whatever annotations it held can't be vouched
    // for, so the loss is asked about and reported.
    console.error(e);
    return UNREADABLE;
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
