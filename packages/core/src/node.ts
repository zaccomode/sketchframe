// Reading and writing Sketchframes on disk, in either form: the single-file
// archive or the older folder package. Node only.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { annotationsFileText } from './annotations.ts';
import type { SketchframeAnnotation } from './annotations.ts';
import { archiveFiles, readArchive, updateArchive, writeArchive } from './archive.ts';
import type { SketchframeFiles } from './archive.ts';
import { ANNOTATIONS_FILE, DESIGN_FILE, MIMETYPE_FILE } from './format.ts';
import { loadSketchframe, SketchframeError } from './model.ts';
import type { Sketchframe } from './model.ts';

/** Opens a `.sketchframe` archive or folder package. */
export function openFiles(path: string): SketchframeFiles {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    throw new SketchframeError(`No such file: ${path}`);
  }
  if (stats.isDirectory()) return folderFiles(path);
  return archiveFiles(new Uint8Array(readFileSync(path)));
}

export function openSketchframe(path: string): Sketchframe {
  return loadSketchframe(openFiles(path));
}

export function folderFiles(root: string): SketchframeFiles {
  if (!existsSync(join(root, DESIGN_FILE))) throw new SketchframeError(`${root} is a folder with no design.json.`);
  return {
    kind: 'folder',
    read: (path) => {
      const full = join(root, ...path.split('/'));
      if (relative(root, full).startsWith('..')) return undefined;
      try {
        return new Uint8Array(readFileSync(full));
      } catch {
        return undefined;
      }
    },
    paths: () => listFiles(root),
  };
}

/** Every file under `root`, relative and `/`-separated, skipping macOS metadata. */
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

/** Unpacks an archive (or copies a folder package) into `dir`. */
export function extract(source: string, dir: string): string[] {
  const files = openFiles(source);
  const paths = files.paths().sort();
  mkdirSync(dir, { recursive: true });
  for (const path of paths) {
    const target = join(dir, ...path.split('/'));
    if (relative(dir, target).startsWith('..')) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, files.read(path) ?? new Uint8Array());
  }
  return paths;
}

/** Packs a folder package (or re-packs an archive) into a single-file archive at `file`. */
export function pack(source: string, file: string) {
  const files = openFiles(source);
  const entries = new Map(files.paths().filter((path) => path !== MIMETYPE_FILE).map((path) => [path, files.read(path) ?? new Uint8Array()]));
  writeAtomically(file, writeArchive(entries));
}

/**
 * Saves annotations into a Sketchframe, the way the Mac app does: rewrites
 * the archive with the new annotations.json (or without one when the list is
 * empty), or writes the file inside a folder package.
 */
export function saveAnnotations(path: string, annotations: SketchframeAnnotation[]) {
  const text = annotations.length ? annotationsFileText(annotations) : null;
  if (statSync(path).isDirectory()) {
    const file = join(path, ANNOTATIONS_FILE);
    if (text === null) rmSync(file, { force: true });
    else writeAtomically(file, new TextEncoder().encode(text));
    return;
  }
  writeAtomically(path, updateArchive(new Uint8Array(readFileSync(path)), { [ANNOTATIONS_FILE]: text }));
}

/** Writes beside the target, then renames over it, so a crash never leaves half a file. */
export function writeAtomically(file: string, bytes: Uint8Array) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, file);
}

/**
 * `.sketchframe` files and folders under `root`, skipping `node_modules`,
 * `.git` and other dot-folders. Paths are relative to `root`.
 */
export function findSketchframes(root: string, limit = 200): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) return;
      const full = join(dir, entry.name);
      if (entry.name.endsWith('.sketchframe')) {
        found.push(relative(root, full).split(sep).join('/'));
      } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walk(full);
      }
    }
  };
  walk(root);
  return found.sort();
}

export { readArchive };
