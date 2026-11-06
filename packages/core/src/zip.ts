// A small zip reader and writer on Node's zlib: enough for Sketchframe
// archives (stored and deflated entries, no encryption or zip64), with no
// dependencies, so the core installs and bundles anywhere Node runs.

import { deflateRawSync, inflateRawSync } from 'node:zlib';

export type ZipEntry = { name: string; data: Uint8Array };
export type ZipInput = { name: string; data: Uint8Array; store?: boolean };

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;

let crcTable: Uint32Array | undefined;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Every entry, in central-directory order, including directories (names ending `/`). */
export function unzip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is at least 22 bytes from the end, after a comment of up to 64 KB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('no end of central directory record');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 0xffff || offset === 0xffffffff) throw new Error('zip64 archives are not supported');

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL) throw new Error('corrupt central directory');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const expectedCRC = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    if (flags & 1) throw new Error(`${name} is encrypted`);
    if (view.getUint32(localOffset, true) !== LOCAL) throw new Error(`corrupt local header for ${name}`);
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = bytes.subarray(start, start + compressedSize);
    let data: Uint8Array;
    if (method === 0) data = raw;
    else if (method === 8) data = new Uint8Array(inflateRawSync(raw));
    else throw new Error(`${name} uses unsupported compression method ${method}`);
    if (data.length !== size || crc32(data) !== expectedCRC) throw new Error(`${name} is corrupt (checksum mismatch)`);
    entries.push({ name, data });
  }
  return entries;
}

/**
 * Writes entries in the order given. `store` keeps an entry uncompressed;
 * otherwise it is deflated unless that doesn't make it smaller. No extra
 * fields, so a stored first entry's contents start at a fixed offset (what
 * `mimetype` sniffing relies on).
 */
export function zip(inputs: ZipInput[], date = new Date(2026, 0, 1)): Uint8Array {
  const encoder = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const input of inputs) {
    const name = encoder.encode(input.name);
    const crc = crc32(input.data);
    let method = 0;
    let body = input.data;
    if (!input.store && input.data.length > 0) {
      const deflated = new Uint8Array(deflateRawSync(input.data, { level: 6 }));
      if (deflated.length < input.data.length) {
        method = 8;
        body = deflated;
      }
    }
    // Bit 11: names are UTF-8.
    const flags = /^[\x20-\x7e]*$/.test(input.name) ? 0 : 0x800;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, input.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL, true);
    cv.setUint16(4, 0x0314, true); // made by: Unix, spec 2.0
    cv.setUint16(6, 20, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, input.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(38, (0o100644 << 16) >>> 0, true); // -rw-r--r--
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, END, true);
  ev.setUint16(8, inputs.length, true);
  ev.setUint16(10, inputs.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let position = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}
