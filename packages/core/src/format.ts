// Names and constants from docs/FORMAT.md, shared by every reader and writer.

/** design.json's `version`. 2 is the single-file archive; 1 was the folder package. */
export const FORMAT_VERSION = 2;

/**
 * The archive's first entry, stored uncompressed, so a tool can recognise a
 * Sketchframe from its first bytes without unzipping it (as EPUB and ODF do).
 */
export const MIMETYPE = 'application/vnd.sketchframe+zip';
export const MIMETYPE_FILE = 'mimetype';
export const DESIGN_FILE = 'design.json';
export const ANNOTATIONS_FILE = 'annotations.json';
export const README_FILE = 'README.md';
export const DEFAULT_PREVIEW_FILE = 'preview@2x.png';
export const ASSETS_DIR = 'assets';

/** Already-compressed formats, which the archive stores rather than deflating again. */
export const STORED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'avif'];

export type JSONObject = Record<string, unknown>;

export function isObject(value: unknown): value is JSONObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Like Swift's `localizedStandardCompare`: case-insensitive, numbers by value. */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Pretty-printed with sorted keys, matching the Mac app's details pane. */
export function prettyJSON(value: unknown): string {
  return JSON.stringify(sortedKeys(value), null, 2);
}

export function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortedKeys(value[key])]),
    );
  }
  return value;
}
