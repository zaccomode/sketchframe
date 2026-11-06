// design.json and annotations.json, parsed into the shapes the viewer draws.
// A port of the Mac app's SketchframePackage.swift and
// SketchframeAnnotation.swift; see docs/FORMAT.md for the format itself.

import { apply, concat, identity, invert, rotate, scale, translate } from './geometry.ts';
import type { Point, Size, Transform } from './geometry.ts';
import { outlineSegments, outlineShape, transformSegments } from './outline.ts';
import type { OutlineShape, Segment } from './outline.ts';
import { nodeSections, styleSections } from './properties.ts';
import type { PropertySection } from './properties.ts';
// Annotations and the preview origin are shared with the CLI and MCP server.
import { annotatedNode, isoNow, parseAnnotations } from '../../packages/core/src/annotations.ts';
import type { AnnotationCategory, SketchframeAnnotation } from '../../packages/core/src/annotations.ts';
import { frameOrigin } from '../../packages/core/src/preview.ts';

export {
  annotationCategories,
  annotationsFileText,
  isoNow,
  parseAnnotations,
} from '../../packages/core/src/annotations.ts';
export type { AnnotationCategory, SketchframeAnnotation } from '../../packages/core/src/annotations.ts';

type JSONObject = Record<string, unknown>;

export type SketchframeNode = {
  id: string;
  /** Stable hash of the Sketch layer ID; survives re-exports. */
  sketchId?: string;
  name: string;
  type: string;
  /** Layer names from the root's children down to this node (empty for the root). */
  path: string[];
  /** For instances: the key of the symbol in `components`. */
  componentId?: string;
  /** Name of the Sketch shared layer or text style applied to this node. */
  sharedStyle?: string;
  /** Keys into design.json's `styles` map that this node references. */
  styleKeys: string[];
  /** Color token names referenced anywhere in this node's style. */
  tokens: Set<string>;
  /** The node's unrotated size, in points. */
  size: Size;
  /**
   * Maps the node's local space (0,0 to width,height) into the root frame's
   * space, including its own and its ancestors' position, rotation and flips.
   */
  transform: Transform;
  /** The shape the canvas outlines: the node's corners, or an ellipse for ovals. */
  shape: OutlineShape;
  children: SketchframeNode[];
  /** The node's properties, grouped for the inspector's GUI view. */
  sections: PropertySection[];
  /** The node's own JSON (without children), with shared style keys resolved. */
  details: string;
  /** Just the node's style fields as JSON, for describing its shared style. */
  styleDetails: string;
  /** Just the node's style fields, grouped for the inspector's GUI view. */
  styleSections: PropertySection[];
};

export type SketchframeComponent = {
  /** Sketch symbol ID. */
  id: string;
  name: string;
  library?: string;
  /** The symbol master's layers, in the master's own coordinate space. */
  root: SketchframeNode;
  /** Instance nodes in the frame that use this symbol. */
  instances: SketchframeNode[];
};

export type SketchframeStyle = {
  id: string;
  name: string;
  /** A named Sketch shared style, or a value reused by several layers. */
  kind: 'shared' | 'reused';
  /** For reused values: `fill`, `border`, `effect`, `corner`, `layout` or `text`. */
  category?: string;
  details: string;
  /** The style's values, grouped for the inspector's GUI view. */
  sections: PropertySection[];
  nodeIds: string[];
};

export type SketchframeColorToken = {
  name: string;
  /** CSS color, e.g. `#3b5bdb` or `rgba(0, 0, 0, 0.5)`. */
  value: string;
  nodeIds: string[];
};

export type SketchframePackage = {
  name: string;
  root: SketchframeNode;
  /** Symbols used in the frame, sorted by name. */
  components: SketchframeComponent[];
  /** Sketch shared styles first, then reused values. */
  styles: SketchframeStyle[];
  colorTokens: SketchframeColorToken[];
  annotations: SketchframeAnnotation[];
  nodeCount: number;
  /** The preview PNG's path inside the package. */
  previewSrc: string;
  /** Preview size in points. Larger than the root frame when shadows overflow it. */
  previewSize: Size;
  /** Where the root frame's top-left sits inside the preview, in points. */
  frameOrigin: Point;
};

/** Style fields that may hold a key into the top-level `styles` map. */
const styleFields = ['fills', 'borders', 'effects', 'corners', 'layout', 'textStyle'];
/** Fields that describe a node's appearance (shown for shared styles). */
const appearanceFields = ['fills', 'borders', 'borderOptions', 'effects', 'corners', 'textStyle', 'opacity', 'blendMode'];

export class SketchframeError extends Error {}

export function parsePackage(designText: string, annotationsText: string | null): SketchframePackage {
  let design: unknown;
  try {
    design = JSON.parse(designText);
  } catch {
    throw new SketchframeError("This Sketchframe's design.json couldn't be read.");
  }
  if (!isObject(design) || design.format !== 'sketchframe' || !isObject(design.root)) {
    throw new SketchframeError("This Sketchframe's design.json couldn't be read.");
  }

  const styleValues = isObject(design.styles) ? design.styles : {};
  const counter = { count: 0 };
  const root = parseNode(design.root, undefined, undefined, styleValues, counter);
  const frameNodes = allNodes(root);

  const preview = isObject(design.preview) ? design.preview : {};
  const previewScale = number(preview.scale) ?? 2;
  const previewSize = {
    width: (number(preview.pixelWidth) ?? root.size.width * previewScale) / previewScale,
    height: (number(preview.pixelHeight) ?? root.size.height * previewScale) / previewScale,
  };

  // Component definitions live outside the frame, in their own coordinate
  // space; their layers don't count towards `nodeCount`.
  const componentCounter = { count: 0 };
  const components = Object.entries(isObject(design.components) ? design.components : {})
    .flatMap(([key, value]): SketchframeComponent[] => {
      if (!isObject(value) || !isObject(value.root)) return [];
      return [
        {
          id: key,
          name: string(value.name) ?? '',
          library: string(value.library),
          root: parseNode(value.root, undefined, undefined, styleValues, componentCounter),
          instances: frameNodes.filter((node) => node.componentId === key),
        },
      ];
    })
    .sort((a, b) => compareNames(a.name, b.name));

  const tokens = isObject(design.tokens) ? design.tokens : {};
  const colorTokens = Object.entries(isObject(tokens.colors) ? tokens.colors : {})
    .map(([name, value]) => ({
      name,
      value: string(value) ?? '',
      nodeIds: frameNodes.filter((node) => node.tokens.has(name)).map((node) => node.id),
    }))
    .sort((a, b) => compareNames(a.name, b.name));

  return {
    name: string(design.name) ?? root.name,
    root,
    components,
    styles: [...sharedStyles(frameNodes), ...reusedStyles(styleValues, frameNodes)],
    colorTokens,
    annotations: parseAnnotations(annotationsText),
    nodeCount: counter.count,
    previewSrc: string(preview.src) ?? 'preview@2x.png',
    previewSize,
    frameOrigin: frameOrigin(preview, design.root, styleValues, {
      width: previewSize.width - root.size.width,
      height: previewSize.height - root.size.height,
    }),
  };
}

// MARK: Lookup

export function allNodes(node: SketchframeNode): SketchframeNode[] {
  return [node, ...node.children.flatMap(allNodes)];
}

/** Top-left, top-right, bottom-right, bottom-left in root coordinates. */
export function corners(node: SketchframeNode): Point[] {
  const { width, height } = node.size;
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((point) => apply(node.transform, point));
}

/** The node's outline (following its corners) in root coordinates. */
export function outline(node: SketchframeNode): Segment[] {
  return transformSegments(outlineSegments(node.shape, node.size), node.transform);
}

export function contains(node: SketchframeNode, point: Point): boolean {
  const local = apply(invert(node.transform), point);
  return local.x >= 0 && local.y >= 0 && local.x <= node.size.width && local.y <= node.size.height;
}

/** The deepest node under `point` (in root coordinates), preferring nodes painted on top. */
export function hitTest(pkg: SketchframePackage, point: Point): SketchframeNode | undefined {
  // Children can sit outside an unclipped parent, so search them even when
  // the parent itself isn't hit.
  const search = (node: SketchframeNode): SketchframeNode | undefined => {
    for (const child of [...node.children].reverse()) {
      const hit = search(child);
      if (hit) return hit;
    }
    return contains(node, point) ? node : undefined;
  };
  return search(pkg.root);
}

/** Searches the frame, then each component's layers. */
export function nodeWithId(pkg: SketchframePackage, id: string): SketchframeNode | undefined {
  for (const root of [pkg.root, ...pkg.components.map((component) => component.root)]) {
    const found = find(id, root);
    if (found) return found;
  }
  return undefined;
}

/**
 * Ids of the nodes above `id` (root first) in the frame or in the component
 * definition that contains it. Empty if `id` isn't found.
 */
export function ancestorIds(pkg: SketchframePackage, id: string): string[] {
  const search = (node: SketchframeNode, trail: string[]): string[] | undefined => {
    if (node.id === id) return trail;
    for (const child of node.children) {
      const found = search(child, [...trail, node.id]);
      if (found) return found;
    }
    return undefined;
  };
  for (const root of [pkg.root, ...pkg.components.map((component) => component.root)]) {
    const trail = search(root, []);
    if (trail) return trail;
  }
  return [];
}

/**
 * The frame layer an annotation belongs to: by Sketch ID, then by layer path,
 * then by the node id it was written against (if the name still matches).
 * `undefined` if the layer is gone.
 */
export function nodeForAnnotation(pkg: SketchframePackage, annotation: SketchframeAnnotation) {
  return annotatedNode(allNodes(pkg.root), annotation);
}

function find(id: string, node: SketchframeNode): SketchframeNode | undefined {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = find(id, child);
    if (found) return found;
  }
  return undefined;
}

// MARK: Annotations

export function newAnnotation(node: SketchframeNode, category: AnnotationCategory, text: string): SketchframeAnnotation {
  return {
    id: crypto.randomUUID().toUpperCase(),
    nodeId: node.id,
    sketchId: node.sketchId,
    layerPath: node.path,
    layerName: node.name,
    category,
    text,
    createdAt: isoNow(),
  };
}

// MARK: Parsing

function parseNode(
  object: JSONObject,
  parentTransform: Transform | undefined,
  parentPath: string[] | undefined,
  styles: JSONObject,
  counter: { count: number },
): SketchframeNode {
  counter.count += 1;
  const size = { width: number(object.width) ?? 0, height: number(object.height) ?? 0 };
  const name = string(object.name) ?? '';
  const path = parentPath ? [...parentPath, name] : [];

  // The root defines the coordinate space, so its own position and rotation
  // are ignored. Other nodes rotate and flip around the centre of their
  // unrotated frame.
  let transform = identity;
  if (parentTransform) {
    const x = number(object.x) ?? 0;
    const y = number(object.y) ?? 0;
    transform = [
      translate(-size.width / 2, -size.height / 2),
      scale(object.flipX === true ? -1 : 1, object.flipY === true ? -1 : 1),
      rotate(number(object.rotation) ?? 0),
      translate(x + size.width / 2, y + size.height / 2),
      parentTransform,
    ].reduce(concat);
  }

  const details: JSONObject = { ...object };
  delete details.children;
  const styleKeys: string[] = [];
  for (const field of styleFields) {
    const key = details[field];
    if (typeof key === 'string' && key in styles) {
      styleKeys.push(key);
      details[field] = styles[key];
    }
  }
  const appearance = Object.fromEntries(Object.entries(details).filter(([key]) => appearanceFields.includes(key)));

  const children = Array.isArray(object.children)
    ? object.children.filter(isObject).map((child) => parseNode(child, transform, path, styles, counter))
    : [];

  return {
    id: string(object.id) ?? crypto.randomUUID(),
    sketchId: string(object.sketchId),
    name,
    type: string(object.type) ?? 'group',
    path,
    componentId: string(object.componentId),
    sharedStyle: string(object.sharedStyle),
    styleKeys,
    tokens: tokenNames(details),
    size,
    transform,
    shape: outlineShape(string(object.type) ?? 'group', details.corners),
    children,
    sections: nodeSections(details),
    details: prettyJSON(details),
    styleDetails: prettyJSON(appearance),
    styleSections: nodeSections(appearance),
  };
}

/** Values of every `token` / `colorToken` key, at any depth. */
function tokenNames(value: unknown, names = new Set<string>()): Set<string> {
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

/** Named Sketch shared styles, described by the first layer that uses each. */
function sharedStyles(nodes: SketchframeNode[]): SketchframeStyle[] {
  const users = new Map<string, SketchframeNode[]>();
  for (const node of nodes) {
    if (node.sharedStyle === undefined) continue;
    users.set(node.sharedStyle, [...(users.get(node.sharedStyle) ?? []), node]);
  }
  return [...users.keys()].sort(compareNames).map((name) => {
    const nodes = users.get(name) ?? [];
    return {
      id: `shared:${name}`,
      name,
      kind: 'shared',
      category: nodes[0]?.type === 'text' ? 'text' : undefined,
      details: nodes[0]?.styleDetails ?? '',
      sections: nodes[0]?.styleSections ?? [],
      nodeIds: nodes.map((node) => node.id),
    };
  });
}

/** Values in design.json's `styles` map, grouped by kind. */
function reusedStyles(styles: JSONObject, nodes: SketchframeNode[]): SketchframeStyle[] {
  const order = ['fill', 'border', 'effect', 'corner', 'layout', 'text'];
  const rank = (style: SketchframeStyle) => {
    const index = order.indexOf(style.category ?? '');
    return index === -1 ? order.length : index;
  };
  return Object.entries(styles)
    .map(([key, value]): SketchframeStyle => ({
      id: `style:${key}`,
      name: key,
      kind: 'reused',
      category: key.split('_')[0],
      details: prettyJSON(value),
      sections: styleSections(key.split('_')[0], value),
      nodeIds: nodes.filter((node) => node.styleKeys.includes(key)).map((node) => node.id),
    }))
    .sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// MARK: Helpers

function isObject(value: unknown): value is JSONObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Like Swift's `localizedStandardCompare`: case-insensitive, numbers by value. */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Pretty-printed with sorted keys, matching the Mac app's details pane. */
export function prettyJSON(value: unknown): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (isObject(value)) {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sorted(value[key])]),
      );
    }
    return value;
  };
  return JSON.stringify(sorted(value), null, 2);
}
