// File naming for exports. Kept free of Sketch and Cocoa APIs so it can be
// unit-tested in Node (plugin/test/file-names.test.mjs).

// File names on APFS are limited to 255 UTF-8 bytes. Base names are trimmed
// well below that, so " 12" and ".sketchframe" still fit after them.
export const MAX_BASE_NAME_BYTES = 200;

// A frame name as a file's base name: no path separators, no leading dots
// (which would hide the file in Finder), and short enough to write.
export function safeFileName(name) {
  const cleaned = String(name)
    .replace(/[/:]/g, "-")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  return trimToBytes(cleaned, MAX_BASE_NAME_BYTES).trim() || "Frame";
}

// How macOS compares file names: without case, and treating the composed and
// decomposed forms of a character ("é" and "e" + U+0301) as the same.
export function fileNameKey(name) {
  return String(name).normalize("NFC").toLowerCase();
}

// Frames often share a name ("Desktop", "Mobile" on several pages). Numbers
// the repeats, "Name 2", "Name 3". `reserved` are names already given to other
// files in this export, which none of these may take.
export function uniqueFileNames(names, reserved = []) {
  const taken = new Set();
  const seen = new Set();
  reserved.forEach((name) => {
    taken.add(fileNameKey(name));
    seen.add(fileNameKey(name));
  });
  names.forEach((name) => taken.add(fileNameKey(name)));
  return names.map((name) => {
    const key = fileNameKey(name);
    if (!seen.has(key)) {
      seen.add(key);
      return name;
    }
    let n = 2;
    while (taken.has(fileNameKey(`${name} ${n}`))) n += 1;
    const unique = `${name} ${n}`;
    taken.add(fileNameKey(unique));
    seen.add(fileNameKey(unique));
    return unique;
  });
}

// A file name per frame, for a folder export. `frames` are `{ base, sketchId }`
// in selection order; `previous` maps a root `sketchId` to the base name of a
// Sketchframe already in the folder that was exported from that frame.
//
// A frame exported to the folder before keeps the file it was given then, so
// re-exporting same-named frames in a different order can't swap their files
// (and their annotations). Only a file named after the frame counts: a renamed
// frame gets a new file. The rest are numbered in selection order, past every
// file in `previous`: those belong to frames (selected or not) that may be
// exported to them again, so a new frame mustn't take one and drop its
// annotations.
export function assignFileNames(frames, previous = {}) {
  const names = [];
  const claimed = new Set();
  frames.forEach(({ base, sketchId }, index) => {
    const name = Object.prototype.hasOwnProperty.call(previous, sketchId) ? previous[sketchId] : undefined;
    if (name && isNumberedName(name, base) && !claimed.has(fileNameKey(name))) {
      names[index] = name;
      claimed.add(fileNameKey(name));
    }
  });

  const unmatched = [];
  frames.forEach((frame, index) => {
    if (names[index] === undefined) unmatched.push(index);
  });
  const owned = Object.keys(previous).map((sketchId) => previous[sketchId]);
  const unique = uniqueFileNames(
    unmatched.map((index) => frames[index].base),
    names.filter((name) => name !== undefined).concat(owned)
  );
  unmatched.forEach((index, i) => {
    names[index] = unique[i];
  });
  return names;
}

// Whether `fileBase` is a name `uniqueFileNames` could give a frame whose safe
// name is `base`: the base itself, or the base plus a number.
export function isNumberedName(fileBase, base) {
  const file = fileNameKey(fileBase);
  const key = fileNameKey(base);
  if (file === key) return true;
  return file.startsWith(`${key} `) && /^[1-9][0-9]*$/.test(file.slice(key.length + 1));
}

// Cuts a string to at most `limit` UTF-8 bytes without splitting a character.
export function trimToBytes(str, limit) {
  let bytes = 0;
  let end = 0;
  for (const char of String(str)) {
    const code = char.codePointAt(0);
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes + size > limit) break;
    bytes += size;
    end += char.length;
  }
  return String(str).slice(0, end);
}
