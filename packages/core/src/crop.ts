// Cuts a node's region out of the preview PNG. Node only (zlib).

import { cropPNG, pngHeader } from './png.ts';
import { previewRegion } from './operations.ts';
import { SketchframeError } from './model.ts';
import type { Node, Rect, Sketchframe } from './model.ts';

export type Crop = {
  png: Uint8Array;
  /** The region of the preview, in pixels. */
  region: Rect;
};

/** The preview, or the part of it showing `node` with `padding` points around it. */
export function cropPreview(frame: Sketchframe, node?: Node, padding = 0): Crop {
  const bytes = frame.files.read(frame.preview.src);
  if (!bytes) throw new SketchframeError(`This Sketchframe has no preview image (${frame.preview.src}).`);
  if (!node) return { png: bytes, region: previewRegion(frame) };

  let header;
  try {
    header = pngHeader(bytes);
  } catch {
    throw new SketchframeError(`The preview image (${frame.preview.src}) isn't a readable PNG.`);
  }
  // design.json's pixel size can disagree with the image if it was edited by
  // hand; the image wins.
  const region = previewRegion(
    { ...frame, preview: { ...frame.preview, pixelWidth: header.width, pixelHeight: header.height } },
    node,
    padding,
  );
  if (region.width === 0 || region.height === 0) {
    throw new SketchframeError(`"${node.name}" (${node.id}) is outside the preview or has no size.`);
  }
  try {
    return { png: cropPNG(bytes, region.x, region.y, region.width, region.height), region };
  } catch (error) {
    throw new SketchframeError(`Couldn't crop the preview: ${error instanceof Error ? error.message : error}.`);
  }
}
