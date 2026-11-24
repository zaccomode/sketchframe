// Run with `npm test` in plugin/. The plugin itself runs in Sketch, but file
// naming is plain JavaScript and is tested here in Node.
import test from "node:test";
import assert from "node:assert/strict";
import {
  assignFileNames,
  MAX_BASE_NAME_BYTES,
  fileNameKey,
  isNumberedName,
  safeFileName,
  trimToBytes,
  uniqueFileNames,
} from "../src/file-names.js";

const utf8Length = (str) => Buffer.byteLength(str, "utf8");

test("numbers repeated names, ignoring case", () => {
  assert.deepEqual(uniqueFileNames(["Desktop", "desktop", "Mobile", "Desktop"]), [
    "Desktop",
    "desktop 2",
    "Mobile",
    "Desktop 3",
  ]);
});

test("skips numbers another frame is already called", () => {
  assert.deepEqual(uniqueFileNames(["A", "A", "A 2"]), ["A", "A 3", "A 2"]);
});

test("doesn't rename frames that share a name with Object.prototype members", () => {
  assert.deepEqual(uniqueFileNames(["Constructor"]), ["Constructor"]);
  assert.deepEqual(uniqueFileNames(["__proto__"]), ["__proto__"]);
  assert.deepEqual(uniqueFileNames(["toString", "hasOwnProperty", "valueOf"]), [
    "toString",
    "hasOwnProperty",
    "valueOf",
  ]);
  assert.deepEqual(uniqueFileNames(["constructor", "Constructor"]), ["constructor", "Constructor 2"]);
});

test("treats composed and decomposed forms of a name as the same file", () => {
  const nfc = "Café";
  const nfd = "Café";
  assert.notEqual(nfc, nfd);
  const names = uniqueFileNames([nfc, nfd]);
  assert.equal(names[0], nfc);
  assert.equal(names[1], `${nfd} 2`);
  assert.notEqual(fileNameKey(names[0]), fileNameKey(names[1]));
});

test("avoids reserved names", () => {
  assert.deepEqual(uniqueFileNames(["Desktop"], ["Desktop 2"]), ["Desktop"]);
  assert.deepEqual(uniqueFileNames(["Desktop", "Desktop"], ["desktop"]), ["Desktop 2", "Desktop 3"]);
  assert.deepEqual(uniqueFileNames(["Desktop", "Desktop"], ["Desktop 2"]), ["Desktop", "Desktop 3"]);
});

test("safeFileName replaces path separators", () => {
  assert.equal(safeFileName("Home/Desktop: Dark"), "Home-Desktop- Dark");
  assert.equal(safeFileName("  "), "Frame");
});

test("safeFileName strips leading dots so the file isn't hidden", () => {
  assert.equal(safeFileName(".hidden"), "hidden");
  assert.equal(safeFileName("...dots"), "dots");
  assert.equal(safeFileName(". spaced"), "spaced");
  assert.equal(safeFileName("..."), "Frame");
  assert.equal(safeFileName("v1.2"), "v1.2");
});

test("safeFileName trims long names so a numbered file name still fits", () => {
  const long = "x".repeat(400);
  const base = safeFileName(long);
  assert.equal(utf8Length(base), MAX_BASE_NAME_BYTES);
  const [, numbered] = uniqueFileNames([base, base]);
  assert.ok(utf8Length(`${numbered}.sketchframe`) <= 255);

  const emoji = "😀".repeat(100); // 4 bytes each
  const trimmed = safeFileName(emoji);
  assert.equal(utf8Length(trimmed), 200);
  assert.equal(trimmed, "😀".repeat(50));

  const accented = "é".repeat(150); // 2 bytes each
  assert.equal(safeFileName(accented), "é".repeat(100));
});

test("trimToBytes never splits a character", () => {
  assert.equal(trimToBytes("a😀", 4), "a");
  assert.equal(trimToBytes("a😀", 5), "a😀");
  assert.equal(trimToBytes("日本語", 7), "日本");
  assert.equal(trimToBytes("short", 200), "short");
});

test("isNumberedName matches a base and its numbered repeats only", () => {
  assert.ok(isNumberedName("Desktop", "Desktop"));
  assert.ok(isNumberedName("desktop 2", "Desktop"));
  assert.ok(isNumberedName("Desktop 12", "Desktop"));
  assert.ok(isNumberedName("Café 2", "Café"));
  assert.ok(!isNumberedName("Desktop Dark", "Desktop"));
  assert.ok(!isNumberedName("Desktop 0", "Desktop"));
  assert.ok(!isNumberedName("Desktop2", "Desktop"));
  assert.ok(!isNumberedName("Mobile", "Desktop"));
});

test("assignFileNames numbers new frames in selection order", () => {
  const frames = [
    { base: "Desktop", sketchId: "aaaaaaaa" },
    { base: "Desktop", sketchId: "bbbbbbbb" },
  ];
  assert.deepEqual(assignFileNames(frames), ["Desktop", "Desktop 2"]);
});

test("assignFileNames keeps each frame's earlier file when the selection order changes", () => {
  const previous = { aaaaaaaa: "Desktop", bbbbbbbb: "Desktop 2" };
  const reversed = [
    { base: "Desktop", sketchId: "bbbbbbbb" },
    { base: "Desktop", sketchId: "aaaaaaaa" },
  ];
  assert.deepEqual(assignFileNames(reversed, previous), ["Desktop 2", "Desktop"]);
});

test("assignFileNames numbers a new frame around files other frames keep", () => {
  const previous = { aaaaaaaa: "Desktop" };
  const frames = [
    { base: "Desktop", sketchId: "cccccccc" },
    { base: "Desktop", sketchId: "aaaaaaaa" },
  ];
  assert.deepEqual(assignFileNames(frames, previous), ["Desktop 2", "Desktop"]);
});

test("assignFileNames gives a renamed frame a file under its new name", () => {
  const previous = { aaaaaaaa: "Desktop" };
  assert.deepEqual(assignFileNames([{ base: "Tablet", sketchId: "aaaaaaaa" }, { base: "Tablet", sketchId: "b" }], previous), [
    "Tablet",
    "Tablet 2",
  ]);
});

test("assignFileNames ignores prototype keys in sketchIds", () => {
  assert.deepEqual(assignFileNames([{ base: "A", sketchId: "constructor" }], {}), ["A"]);
});
