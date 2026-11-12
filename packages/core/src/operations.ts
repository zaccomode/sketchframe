// What the CLI, the MCP server and the VS Code language-model tools do with a
// Sketchframe. Each returns plain data; the front ends format it.

import type { SketchframeAnnotation } from './annotations.ts';
import { ANNOTATIONS_FILE, DESIGN_FILE, isObject, prettyJSON, sortedKeys } from './format.ts';
import { strFromU8 } from './archive.ts';
import type { SketchframeFiles } from './archive.ts';
import type { JSONObject } from './format.ts';
import {
  allNodes,
  bounds,
  everyNode,
  isInFrame,
  isMissingAsset,
  nodeForAnnotation,
  resolvedFields,
  styleKeys,
  tokenNames,
} from './model.ts';
import type { Node, Rect, Sketchframe } from './model.ts';

// MARK: Outline

export type OutlineOptions = {
  /** Levels below the starting node to include; unlimited when omitted. */
  depth?: number;
};

/**
 * A compact tree, one line per node: `name [type] x,y w×h id`, indented two
 * spaces per level, with instances' components, rotation and annotation
 * counts. Positions are relative to the parent, as in design.json.
 */
export function outline(frame: Sketchframe, start: Node = frame.root, options: OutlineOptions = {}): string {
  const notes = annotationCounts(frame);
  const lines: string[] = [];
  const walk = (node: Node, depth: number) => {
    const position = node.raw.x === undefined || node === start ? '' : ` ${num(node.raw.x)},${num(node.raw.y)}`;
    const extras = [
      typeof node.raw.component === 'string' ? `◆ ${node.raw.component}` : '',
      typeof node.raw.rotation === 'number' ? `↻${node.raw.rotation}°` : '',
      typeof node.raw.text === 'string' ? JSON.stringify(truncate(node.raw.text, 40)) : '',
      notes.get(node.id) ? `✎${notes.get(node.id)}` : '',
      isMissingAsset(frame, node) ? '⚠ asset missing' : '',
    ].filter(Boolean);
    lines.push(
      `${'  '.repeat(depth)}${node.name || '(unnamed)'} [${node.type}]${position} ${num(node.size.width)}×${num(node.size.height)} ${node.id}${
        extras.length ? `  ${extras.join('  ')}` : ''
      }`,
    );
    if (options.depth !== undefined && depth >= options.depth) {
      const hidden = allNodes(node).length - 1;
      if (hidden > 0) lines.push(`${'  '.repeat(depth + 1)}… ${hidden} more`);
      return;
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(start, 0);
  return lines.join('\n');
}

/** A few lines about the whole file, shown above the outline. */
export function summary(frame: Sketchframe): string {
  const nodes = allNodes(frame.root).length;
  const { pixelWidth, pixelHeight, scale } = frame.preview;
  return [
    `${frame.name}: ${num(frame.root.size.width)}×${num(frame.root.size.height)} pt, ${nodes} layers` +
      (frame.components.length ? `, ${frame.components.length} components` : '') +
      (frame.annotations.length ? `, ${frame.annotations.length} annotations` : ''),
    `Preview: ${frame.preview.src}, ${pixelWidth}×${pixelHeight} px at ${scale}x; the frame starts ${num(frame.frameOrigin.x)},${num(frame.frameOrigin.y)} pt into it.`,
    missingAssetsLine(frame),
    typeof frame.design.generator === 'string' ? `Exported by ${frame.design.generator}${typeof frame.design.exportedAt === 'string' ? ` at ${frame.design.exportedAt}` : ''}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Says which vectors the exporter couldn't turn into SVG, so an agent knows
 * to rebuild them rather than leave a blank box. Empty when there are none.
 */
function missingAssetsLine(frame: Sketchframe): string {
  const missing = frame.missingAssets;
  if (!missing.length) return '';
  const nodes = everyNode(frame);
  const names = missing.map((asset) => {
    const node = nodes.find((each) => each.id === asset.id);
    const name = (node?.path.join('/') || asset.name || node?.name) ?? '';
    return name ? `${name} (${asset.id})` : asset.id;
  });
  const count = missing.length === 1 ? "1 vector couldn't" : `${missing.length} vectors couldn't`;
  return `${count} be exported (${names.join(', ')}); rebuild ${missing.length === 1 ? 'it' : 'them'} from the preview or ask for the asset.`;
}

// MARK: Node context

export type NodeOptions = {
  /** Levels of children to include; all of them when omitted. */
  depth?: number;
};

/**
 * Everything needed to build one node: its subtree with shared styles
 * resolved inline, where it sits in the frame, the tokens it uses with their
 * values, the component it instantiates, and the annotations on it and its
 * descendants.
 */
export function nodeContext(frame: Sketchframe, node: Node, options: NodeOptions = {}): JSONObject {
  const tree = (current: Node, depth: number): JSONObject => {
    const fields = resolvedFields(frame, current);
    if (current.children.length === 0) return fields;
    if (options.depth !== undefined && depth >= options.depth) {
      return { ...fields, children: `${current.children.length} ${current.children.length === 1 ? 'child' : 'children'} omitted; ask for them by id` };
    }
    return { ...fields, children: current.children.map((child) => tree(child, depth + 1)) };
  };

  const subtree = allNodes(node);
  const used = new Set<string>();
  for (const each of subtree) tokenNames(resolvedFields(frame, each), used);
  const tokens = Object.fromEntries([...used].sort().map((name) => [name, frame.colors[name] ?? null]));

  const keys = [...new Set(subtree.flatMap((each) => styleKeys(frame, each)))].sort();
  const sharedStyles = [...new Set(subtree.flatMap((each) => (typeof each.raw.sharedStyle === 'string' ? [each.raw.sharedStyle] : [])))].sort();

  const inFrame = isInFrame(frame, node);
  const componentId = typeof node.raw.componentId === 'string' ? node.raw.componentId : undefined;
  const component = componentId ? frame.components.find((each) => each.id === componentId) : undefined;
  const ids = new Set(subtree.map((each) => each.id));
  const annotations = inFrame
    ? frame.annotations.flatMap((annotation) => {
        const target = nodeForAnnotation(frame, annotation);
        return target && ids.has(target.id) ? [annotationSummary(annotation, target)] : [];
      })
    : [];

  const missingAssets = subtree
    .filter((each) => isMissingAsset(frame, each))
    .map((each) => ({
      id: each.id,
      name: each.name,
      note: "This vector couldn't be exported as SVG, so it has no src. Rebuild it from the preview (get_screenshot) or ask for the asset.",
    }));

  return clean({
    id: node.id,
    name: node.name,
    type: node.type,
    path: node.path.join('/') || '/',
    parent: node.parent ? { id: node.parent.id, name: node.parent.name, layout: resolvedFields(frame, node.parent).layout } : undefined,
    where: inFrame ? 'frame' : 'component definition',
    bounds: inFrame ? { ...bounds(node), note: 'In frame coordinates (points), axis-aligned around any rotation.' } : undefined,
    component: component ? { id: component.id, name: component.name, library: component.library } : undefined,
    tokens: Object.keys(tokens).length ? tokens : undefined,
    reusedStyles: keys.length ? keys : undefined,
    sharedStyles: sharedStyles.length ? sharedStyles : undefined,
    annotations: annotations.length ? annotations : undefined,
    missingAssets: missingAssets.length ? missingAssets : undefined,
    node: tree(node, 0),
  });
}

// MARK: Tokens

/** Color tokens with their values and users, Sketch shared styles, and reused style values. */
export function tokens(frame: Sketchframe): JSONObject {
  const nodes = allNodes(frame.root);
  const users = (match: (node: Node) => boolean) => nodes.filter(match).map((node) => node.id);
  const colors = Object.fromEntries(
    Object.entries(frame.colors)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, value]) => [name, { value, usedBy: users((node) => tokenNames(resolvedFields(frame, node)).has(name)) }]),
  );
  const sharedNames = [...new Set(nodes.flatMap((node) => (typeof node.raw.sharedStyle === 'string' ? [node.raw.sharedStyle] : [])))].sort();
  const sharedStyles = Object.fromEntries(
    sharedNames.map((name) => {
      const usedBy = nodes.filter((node) => node.raw.sharedStyle === name);
      const fields = resolvedFields(frame, usedBy[0]);
      const appearance = Object.fromEntries(
        Object.entries(fields).filter(([key]) =>
          ['fills', 'borders', 'borderOptions', 'effects', 'corners', 'textStyle', 'opacity', 'blendMode'].includes(key),
        ),
      );
      return [name, { usedBy: usedBy.map((node) => node.id), value: appearance }];
    }),
  );
  const reusedStyles = Object.fromEntries(
    Object.entries(frame.styles).map(([key, value]) => [key, { value, usedBy: users((node) => styleKeys(frame, node).includes(key)) }]),
  );
  return clean({
    colors: Object.keys(colors).length ? colors : undefined,
    sharedStyles: Object.keys(sharedStyles).length ? sharedStyles : undefined,
    reusedStyles: Object.keys(reusedStyles).length ? reusedStyles : undefined,
  });
}

// MARK: Annotations

export function annotations(frame: Sketchframe): JSONObject[] {
  return frame.annotations.map((annotation) => annotationSummary(annotation, nodeForAnnotation(frame, annotation)));
}

function annotationSummary(annotation: SketchframeAnnotation, node: Node | undefined): JSONObject {
  return clean({
    id: annotation.id,
    category: annotation.category,
    text: annotation.text,
    layer: node
      ? { id: node.id, name: node.name, path: node.path.join('/') || '/', bounds: bounds(node) }
      : { detached: true, name: annotation.layerName, path: annotation.layerPath.join('/'), note: 'The layer is no longer in the design.' },
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
  });
}

function annotationCounts(frame: Sketchframe): Map<string, number> {
  const counts = new Map<string, number>();
  for (const annotation of frame.annotations) {
    const node = nodeForAnnotation(frame, annotation);
    if (node) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
  }
  return counts;
}

// MARK: Crop region

/**
 * The preview's pixel rectangle showing `node`, with `padding` points around
 * it, clipped to the preview. The whole preview when `node` is omitted.
 */
export function previewRegion(frame: Sketchframe, node?: Node, padding = 0): Rect {
  const { scale, pixelWidth, pixelHeight } = frame.preview;
  if (!node) return { x: 0, y: 0, width: pixelWidth, height: pixelHeight };
  const box = bounds(node);
  const left = Math.max(0, Math.floor((box.x - padding + frame.frameOrigin.x) * scale));
  const top = Math.max(0, Math.floor((box.y - padding + frame.frameOrigin.y) * scale));
  const right = Math.min(pixelWidth, Math.ceil((box.x + box.width + padding + frame.frameOrigin.x) * scale));
  const bottom = Math.min(pixelHeight, Math.ceil((box.y + box.height + padding + frame.frameOrigin.y) * scale));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

// MARK: Text rendering

/**
 * A stable text rendering of a Sketchframe for `git diff`: the file list,
 * design.json with sorted keys, and annotations.json. Images are listed by
 * size only.
 */
export function catText(files: SketchframeFiles): string {
  const parts: string[] = [];
  const paths = files.paths().sort();
  parts.push(`# Sketchframe (${files.kind})`, '', '## Files', '');
  for (const path of paths) parts.push(`${path}  ${files.read(path)?.length ?? 0} bytes`);
  for (const name of [DESIGN_FILE, ANNOTATIONS_FILE]) {
    const bytes = files.read(name);
    if (!bytes) continue;
    parts.push('', `## ${name}`, '');
    const text = strFromU8(bytes);
    try {
      const json = JSON.parse(text);
      // `exportedAt` changes on every export; leaving it in would make every
      // re-export show a change even when the design didn't.
      if (name === DESIGN_FILE && isObject(json)) delete json.exportedAt;
      parts.push(prettyJSON(json));
    } catch {
      parts.push(text.trimEnd());
    }
  }
  return `${parts.join('\n')}\n`;
}

// MARK: Helpers

export function toJSON(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export { sortedKeys };

function num(value: unknown): string {
  return typeof value === 'number' ? String(Math.round(value * 100) / 100) : '?';
}

function truncate(text: string, length: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
}

function clean(object: JSONObject): JSONObject {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}
