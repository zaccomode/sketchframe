// design.json parsed for tools: the node tree positioned in the root frame's
// space, lookups, and resolving a node's shared styles and tokens. A lean
// port of the Mac app's SketchframePackage.swift; see docs/FORMAT.md.

import { annotatedNode, parseAnnotations } from './annotations.ts';
import type { SketchframeAnnotation } from './annotations.ts';
import { text } from './archive.ts';
import type { SketchframeFiles } from './archive.ts';
import { ANNOTATIONS_FILE, DEFAULT_PREVIEW_FILE, DESIGN_FILE, compareNames, isObject, number, string } from './format.ts';
import type { JSONObject } from './format.ts';
import { apply, concat, identity, rotate, scale, translate } from './geometry.ts';
import type { Point, Size, Transform } from './geometry.ts';

/** Style fields that may hold a key into the top-level `styles` map. */
export const styleFields = ['fills', 'borders', 'effects', 'corners', 'layout', 'textStyle'];

export type Node = {
  id: string;
  sketchId?: string;
  name: string;
  type: string;
  /** Layer names from the root's children down to this node (empty for the root). */
  path: string[];
  /** The node's own fields from design.json, without `children`, as written. */
  raw: JSONObject;
  size: Size;
  /** Maps the node's local space into its root's space (the frame, or a component's master). */
  transform: Transform;
  parent?: Node;
  children: Node[];
};

export type Component = { id: string; name: string; library?: string; root: Node };

export type Rect = { x: number; y: number; width: number; height: number };

export type Sketchframe = {
  name: string;
  design: JSONObject;
  root: Node;
  components: Component[];
  /** design.json's `styles`: values shared by several nodes, by key. */
  styles: JSONObject;
  /** Color tokens: name → CSS color. */
  colors: Record<string, string>;
  annotations: SketchframeAnnotation[];
  preview: { src: string; scale: number; pixelWidth: number; pixelHeight: number };
  /** Where the root frame's top-left sits inside the preview, in points. */
  frameOrigin: Point;
  files: SketchframeFiles;
};

export class SketchframeError extends Error {}

export function loadSketchframe(files: SketchframeFiles): Sketchframe {
  const designText = text(files, DESIGN_FILE);
  if (designText === undefined) throw new SketchframeError('This Sketchframe has no design.json.');
  let design: unknown;
  try {
    design = JSON.parse(designText);
  } catch {
    throw new SketchframeError("This Sketchframe's design.json isn't valid JSON.");
  }
  if (!isObject(design) || design.format !== 'sketchframe' || !isObject(design.root)) {
    throw new SketchframeError("This Sketchframe's design.json isn't a Sketchframe design.");
  }

  const root = parseNode(design.root, undefined);
  const components = Object.entries(isObject(design.components) ? design.components : {})
    .flatMap(([id, value]): Component[] =>
      isObject(value) && isObject(value.root)
        ? [{ id, name: string(value.name) ?? '', library: string(value.library), root: parseNode(value.root, undefined) }]
        : [],
    )
    .sort((a, b) => compareNames(a.name, b.name));

  const styles = isObject(design.styles) ? design.styles : {};
  const tokens = isObject(design.tokens) ? design.tokens : {};
  const colors = Object.fromEntries(
    Object.entries(isObject(tokens.colors) ? tokens.colors : {}).flatMap(([name, value]) =>
      typeof value === 'string' ? [[name, value]] : [],
    ),
  );

  const previewObject = isObject(design.preview) ? design.preview : {};
  const previewScale = number(previewObject.scale) ?? 2;
  const preview = {
    src: string(previewObject.src) ?? DEFAULT_PREVIEW_FILE,
    scale: previewScale,
    pixelWidth: number(previewObject.pixelWidth) ?? root.size.width * previewScale,
    pixelHeight: number(previewObject.pixelHeight) ?? root.size.height * previewScale,
  };

  return {
    name: string(design.name) ?? root.name,
    design,
    root,
    components,
    styles,
    colors,
    annotations: parseAnnotations(text(files, ANNOTATIONS_FILE)),
    preview,
    frameOrigin: frameOrigin(previewObject, design.root, styles, {
      width: preview.pixelWidth / previewScale - root.size.width,
      height: preview.pixelHeight / previewScale - root.size.height,
    }),
    files,
  };
}

function parseNode(object: JSONObject, parent: Node | undefined): Node {
  const size = { width: number(object.width) ?? 0, height: number(object.height) ?? 0 };
  const name = string(object.name) ?? '';

  // The root defines the coordinate space, so its own position and rotation
  // are ignored. Other nodes rotate and flip around the centre of their
  // unrotated frame.
  let transform = identity;
  if (parent) {
    const x = number(object.x) ?? 0;
    const y = number(object.y) ?? 0;
    transform = [
      translate(-size.width / 2, -size.height / 2),
      scale(object.flipX === true ? -1 : 1, object.flipY === true ? -1 : 1),
      rotate(number(object.rotation) ?? 0),
      translate(x + size.width / 2, y + size.height / 2),
      parent.transform,
    ].reduce(concat);
  }

  const raw: JSONObject = { ...object };
  delete raw.children;
  const node: Node = {
    id: string(object.id) ?? '',
    sketchId: string(object.sketchId),
    name,
    type: string(object.type) ?? 'group',
    path: parent ? [...parent.path, name] : [],
    raw,
    size,
    transform,
    parent,
    children: [],
  };
  node.children = Array.isArray(object.children)
    ? object.children.filter(isObject).map((child) => parseNode(child, node))
    : [];
  return node;
}

// MARK: Lookup

/** This node and its descendants, depth first. */
export function allNodes(node: Node): Node[] {
  return [node, ...node.children.flatMap(allNodes)];
}

/** The frame's nodes, then each component's. */
export function everyNode(frame: Sketchframe): Node[] {
  return [frame.root, ...frame.components.map((component) => component.root)].flatMap(allNodes);
}

/** True if the node is in the frame (and so in the preview), not a component definition. */
export function isInFrame(frame: Sketchframe, node: Node): boolean {
  let top = node;
  while (top.parent) top = top.parent;
  return top === frame.root;
}

/**
 * Finds a node by any of the ways a person or agent might name it: its `id`
 * (`n12`), its `sketchId`, its layer path (`Header/Title`, from the root's
 * children down; `/` alone is the root), or its name when only one node has
 * it. Searches the frame, then component definitions.
 */
export function findNode(frame: Sketchframe, query: string): Node | undefined {
  const nodes = everyNode(frame);
  const frameNodes = allNodes(frame.root);
  const trimmed = query.trim();
  if (trimmed === '' || trimmed === '/') return frame.root;
  const byId = nodes.find((node) => node.id === trimmed) ?? nodes.find((node) => node.sketchId === trimmed);
  if (byId) return byId;
  const path = trimmed.replace(/^\/+|\/+$/g, '').split('/');
  const byPath = frameNodes.find((node) => node.path.length === path.length && node.path.every((name, i) => name === path[i]));
  if (byPath) return byPath;
  const byName = nodes.filter((node) => node.name === trimmed);
  return byName.length === 1 ? byName[0] : undefined;
}

/** Like `findNode`, but throws a message that says how to find a node instead. */
export function requireNode(frame: Sketchframe, query: string): Node {
  const node = findNode(frame, query);
  if (node) return node;
  const matches = everyNode(frame).filter((node) => node.name === query.trim());
  if (matches.length > 1) {
    throw new SketchframeError(
      `${matches.length} layers are named "${query}" (${matches.map((node) => node.id).join(', ')}). Pass an id or a layer path instead.`,
    );
  }
  throw new SketchframeError(`No layer matches "${query}". Use an id from the outline (e.g. n4), a sketchId or a layer path (e.g. Header/Title).`);
}

/** The frame layer an annotation belongs to, or `undefined` if it's gone. */
export function nodeForAnnotation(frame: Sketchframe, annotation: SketchframeAnnotation): Node | undefined {
  return annotatedNode(allNodes(frame.root), annotation);
}

/** Top-left, top-right, bottom-right, bottom-left in the root's space. */
export function corners(node: Node): Point[] {
  const { width, height } = node.size;
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((point) => apply(node.transform, point));
}

/** The axis-aligned box around the node's corners, in the root's space. */
export function bounds(node: Node): Rect {
  const points = corners(node);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x: tidy(x), y: tidy(y), width: tidy(Math.max(...xs) - x), height: tidy(Math.max(...ys) - y) };
}

// MARK: Resolving

/** The node's fields with style keys replaced by the values they refer to. */
export function resolvedFields(frame: Sketchframe, node: Node): JSONObject {
  const fields: JSONObject = { ...node.raw };
  for (const field of styleFields) {
    const key = fields[field];
    if (typeof key === 'string' && key in frame.styles) fields[field] = frame.styles[key];
  }
  return fields;
}

/** Keys into `styles` that the node refers to. */
export function styleKeys(frame: Sketchframe, node: Node): string[] {
  return styleFields.flatMap((field) => {
    const key = node.raw[field];
    return typeof key === 'string' && key in frame.styles ? [key] : [];
  });
}

/** Values of every `token` / `colorToken` key, at any depth. */
export function tokenNames(value: unknown, names = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const child of value) tokenNames(child, names);
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'token' || key === 'colorToken') && typeof child === 'string') {
        names.add(child);
      } else {
        tokenNames(child, names);
      }
    }
  }
  return names;
}

/**
 * Uses `preview.origin` when the exporter recorded it. Older exports don't
 * have it, so it's derived from the root's shadows and borders (which Sketch
 * renders outside the frame), falling back to an even split when that doesn't
 * account for all of the overflow.
 */
export function frameOrigin(preview: JSONObject, root: JSONObject, styles: JSONObject, overflow: Size): Point {
  if (isObject(preview.origin)) {
    const x = number(preview.origin.x);
    const y = number(preview.origin.y);
    if (x !== undefined && y !== undefined) return { x, y };
  }

  const resolved = (field: string) => (typeof root[field] === 'string' ? styles[root[field]] : root[field]);

  let left = 0;
  let top = 0;
  let right = 0;
  let bottom = 0;
  const extend = (l: number, t: number, r: number, b: number) => {
    left = Math.max(left, l);
    top = Math.max(top, t);
    right = Math.max(right, r);
    bottom = Math.max(bottom, b);
  };

  const effects = resolved('effects');
  const shadows = isObject(effects) && Array.isArray(effects.shadows) ? effects.shadows.filter(isObject) : [];
  for (const shadow of shadows) {
    if (shadow.inset === true) continue;
    const x = number(shadow.x) ?? 0;
    const y = number(shadow.y) ?? 0;
    const reach = (number(shadow.blur) ?? 0) + (number(shadow.spread) ?? 0);
    extend(reach - x, reach - y, reach + x, reach + y);
  }
  const borders = resolved('borders');
  for (const border of Array.isArray(borders) ? borders.filter(isObject) : []) {
    const thickness = number(border.thickness) ?? 0;
    if (border.position === 'outside') extend(thickness, thickness, thickness, thickness);
    if (border.position === 'center') extend(thickness / 2, thickness / 2, thickness / 2, thickness / 2);
  }

  return {
    x: Math.abs(left + right - overflow.width) <= 1 ? left : overflow.width / 2,
    y: Math.abs(top + bottom - overflow.height) <= 1 ? top : overflow.height / 2,
  };
}

/** Rounds away floating-point noise from rotation (e.g. 1e-15 → 0). */
function tidy(value: number): number {
  return Math.round(value * 1000) / 1000 + 0;
}
