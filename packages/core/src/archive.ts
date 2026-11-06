// The .sketchframe archive: a zip whose first entry is an uncompressed
// `mimetype` file, followed by the same files the folder package held.
// Uses Node's zlib (see zip.ts), so it has no dependencies. The Sketch
// plugin, which has no zlib, writes the same layout with fflate. See
// docs/FORMAT.md.

import { unzip, zip } from './zip.ts';
import {
  ANNOTATIONS_FILE,
  DEFAULT_PREVIEW_FILE,
  DESIGN_FILE,
  MIMETYPE,
  MIMETYPE_FILE,
  README_FILE,
  STORED_EXTENSIONS,
} from './format.ts';

/** File paths inside a Sketchframe (`design.json`, `assets/img_….png`) and their bytes. */
export type Entries = Map<string, Uint8Array>;

/** Files a reader needs, whichever form the Sketchframe is in. */
export interface SketchframeFiles {
  /** `archive` for the single-file zip, `folder` for the older folder package. */
  readonly kind: 'archive' | 'folder';
  read(path: string): Uint8Array | undefined;
  /** Every file's path, relative to the Sketchframe's root, `/`-separated. */
  paths(): string[];
}

/** True if `bytes` start like a zip (a local file header). */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * True if `bytes` are a Sketchframe archive by its `mimetype` entry: a zip
 * whose first entry is named `mimetype`, stored, holding the media type.
 */
export function hasSketchframeMimetype(bytes: Uint8Array): boolean {
  if (!isZip(bytes) || bytes.length < 30) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const method = view.getUint16(8, true);
  const size = view.getUint32(18, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const name = strFromU8(bytes.subarray(30, 30 + nameLength));
  const start = 30 + nameLength + extraLength;
  if (name !== MIMETYPE_FILE || method !== 0 || start + size > bytes.length) return false;
  return strFromU8(bytes.subarray(start, start + size)) === MIMETYPE;
}

/**
 * Reads every file in an archive. Directory entries, `mimetype` and macOS
 * metadata are left out. A zip of a folder package (`Name.sketchframe/…`, as
 * Finder's Compress makes) reads as if the folder were the root.
 */
export function readArchive(bytes: Uint8Array): Entries {
  let files;
  try {
    files = unzip(bytes);
  } catch (error) {
    throw new Error(`Not a readable Sketchframe archive (${error instanceof Error ? error.message : error}).`);
  }
  let entries: Entries = new Map(
    files
      .filter(({ name }) => !name.endsWith('/') && !name.startsWith('__MACOSX/') && !name.endsWith('.DS_Store') && name !== MIMETYPE_FILE)
      .map(({ name, data }) => [name, data]),
  );

  if (!entries.has(DESIGN_FILE)) {
    const prefixes = new Set([...entries.keys()].map((path) => path.split('/')[0]));
    const [prefix] = prefixes;
    if (prefixes.size === 1 && entries.has(`${prefix}/${DESIGN_FILE}`)) {
      entries = new Map([...entries].map(([path, data]) => [path.slice(prefix.length + 1), data]));
    }
  }
  return entries;
}

export function archiveFiles(bytes: Uint8Array): SketchframeFiles {
  const entries = readArchive(bytes);
  return { kind: 'archive', read: (path) => entries.get(normalise(path)), paths: () => [...entries.keys()] };
}

/** The order entries are written in: what a reader wants first, then assets. */
const leadingFiles = [README_FILE, DESIGN_FILE, ANNOTATIONS_FILE, DEFAULT_PREVIEW_FILE];

/**
 * Writes an archive: `mimetype` first and stored, then README, design,
 * annotations and preview, then everything else sorted. Images are stored,
 * since deflating a PNG again only costs time; text is deflated.
 */
export function writeArchive(entries: Entries | Record<string, Uint8Array | string>): Uint8Array {
  const map = entries instanceof Map ? entries : new Map(Object.entries(entries));
  const paths = [...map.keys()]
    .map(normalise)
    .filter((path) => path !== MIMETYPE_FILE && path !== '' && !path.endsWith('/'));
  const rank = (path: string) => {
    const index = leadingFiles.indexOf(path);
    return index === -1 ? leadingFiles.length : index;
  };
  paths.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));

  // zip() uses a fixed date, which keeps the archive's bytes the same for the
  // same contents, so saving an annotation doesn't change every entry.
  const inputs = [{ name: MIMETYPE_FILE, data: strToU8(MIMETYPE), store: true }];
  for (const path of paths) {
    const value = map.get(path) ?? map.get(`./${path}`);
    if (value === undefined) continue;
    const data = typeof value === 'string' ? strToU8(value) : value;
    const extension = path.split('.').pop()?.toLowerCase() ?? '';
    inputs.push({ name: path, data, store: STORED_EXTENSIONS.includes(extension) });
  }
  return zip(inputs);
}

/**
 * A copy of the archive with some files replaced (`Uint8Array`/`string`) or
 * removed (`null`). Used to save annotations without touching the rest.
 */
export function updateArchive(bytes: Uint8Array, changes: Record<string, Uint8Array | string | null>): Uint8Array {
  const entries: Map<string, Uint8Array | string> = readArchive(bytes);
  for (const [path, value] of Object.entries(changes)) {
    if (value === null) entries.delete(path);
    else entries.set(path, value);
  }
  return writeArchive(Object.fromEntries(entries));
}

export function text(files: SketchframeFiles, path: string): string | undefined {
  const bytes = files.read(path);
  return bytes === undefined ? undefined : strFromU8(bytes);
}

export function strToU8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function strFromU8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** `./a//b` → `a/b`. Paths in design.json are relative to the root. */
function normalise(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+/g, '/');
}
