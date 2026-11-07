// Crops a PNG on Node's zlib alone: decodes the scanlines, copies the
// rectangle and re-encodes it in the same pixel format, keeping the palette,
// transparency and colour-space chunks. Handles every non-interlaced PNG,
// which covers what Sketch exports.

import { deflateSync, inflateSync } from 'node:zlib';
import { crc32 } from './zip.ts';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Chunks that describe pixels' meaning, kept in the crop. */
const KEPT = new Set(['PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs']);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export type PNGHeader = { width: number; height: number; bitDepth: number; colorType: number; interlace: number };

type Chunk = { type: string; data: Uint8Array };

function chunks(bytes: Uint8Array): Chunk[] {
  if (bytes.length < 8 || SIGNATURE.some((value, i) => bytes[i] !== value)) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Chunk[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    out.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return out;
}

export function pngHeader(bytes: Uint8Array): PNGHeader {
  const ihdr = chunks(bytes).find((chunk) => chunk.type === 'IHDR');
  if (!ihdr) throw new Error('PNG has no header');
  const view = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  return { width: view.getUint32(0), height: view.getUint32(4), bitDepth: ihdr.data[8], colorType: ihdr.data[9], interlace: ihdr.data[12] };
}

/** The `width`×`height` rectangle at `x`,`y`, which must lie inside the image. */
export function cropPNG(bytes: Uint8Array, x: number, y: number, width: number, height: number): Uint8Array {
  const all = chunks(bytes);
  const header = pngHeader(bytes);
  if (header.interlace !== 0) throw new Error('interlaced PNGs are not supported');
  const channels = CHANNELS[header.colorType];
  if (!channels) throw new Error(`unknown PNG colour type ${header.colorType}`);
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > header.width || y + height > header.height) {
    throw new Error('crop rectangle is outside the image');
  }

  const bitsPerPixel = channels * header.bitDepth;
  const filterStep = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((header.width * bitsPerPixel) / 8);
  const compressed = concat(all.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data));
  const raw = new Uint8Array(inflateSync(compressed));
  if (raw.length < (stride + 1) * header.height) throw new Error('PNG image data is truncated');

  // Only rows up to the crop's bottom need unfiltering.
  const rows: Uint8Array[] = [];
  let previous: Uint8Array = new Uint8Array(stride);
  for (let row = 0; row < y + height; row++) {
    const start = row * (stride + 1);
    const line = unfilter(raw[start], raw.subarray(start + 1, start + 1 + stride), previous, filterStep);
    if (row >= y) rows.push(line);
    previous = line;
  }

  const outStride = Math.ceil((width * bitsPerPixel) / 8);
  const out = new Uint8Array((outStride + 1) * height);
  rows.forEach((line, index) => {
    const target = out.subarray(index * (outStride + 1) + 1, (index + 1) * (outStride + 1));
    if (bitsPerPixel % 8 === 0) {
      const bytesPerPixel = bitsPerPixel / 8;
      target.set(line.subarray(x * bytesPerPixel, (x + width) * bytesPerPixel));
    } else {
      // Sub-byte pixels (1, 2 or 4-bit palette or grey): copy bit by bit.
      for (let i = 0; i < width * bitsPerPixel; i++) {
        const from = x * bitsPerPixel + i;
        if (line[from >> 3] & (0x80 >> (from & 7))) target[i >> 3] |= 0x80 >> (i & 7);
      }
    }
  });

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([header.bitDepth, header.colorType, 0, 0, 0], 8);
  return concat([
    new Uint8Array(SIGNATURE),
    chunk('IHDR', ihdr),
    ...all.filter((each) => KEPT.has(each.type)).map((each) => chunk(each.type, each.data)),
    chunk('IDAT', new Uint8Array(deflateSync(out))),
    chunk('IEND', new Uint8Array()),
  ]);
}

function unfilter(type: number, line: Uint8Array, previous: Uint8Array, step: number): Uint8Array {
  const out = new Uint8Array(line.length);
  for (let i = 0; i < line.length; i++) {
    const left = i >= step ? out[i - step] : 0;
    const up = previous[i];
    const upLeft = i >= step ? previous[i - step] : 0;
    let predictor = 0;
    switch (type) {
      case 0:
        break;
      case 1:
        predictor = left;
        break;
      case 2:
        predictor = up;
        break;
      case 3:
        predictor = (left + up) >> 1;
        break;
      case 4: {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        break;
      }
      default:
        throw new Error(`unknown PNG filter ${type}`);
    }
    out[i] = (line[i] + predictor) & 0xff;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
