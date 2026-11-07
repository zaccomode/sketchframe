// The Sketchframe tools, defined once for the MCP server, the CLI and VS
// Code's language-model tools. Modelled on Figma's MCP server: an outline of
// the tree, one node's full context, a screenshot of one node, and the design
// tokens, so an agent never has to read the whole design.json.

import { Buffer } from 'node:buffer';
import { isAbsolute, resolve } from 'node:path';
import { htmlForNode } from './code.ts';
import { cropPreview } from './crop.ts';
import { findSketchframes, openSketchframe } from './node.ts';
import { annotations, nodeContext, outline, summary, tokens, toJSON } from './operations.ts';
import { requireNode, SketchframeError } from './model.ts';

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export type JSONSchema = {
  type: 'object';
  properties: Record<string, { type: string; description: string; minimum?: number; enum?: string[] }>;
  required?: string[];
  additionalProperties?: boolean;
};

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JSONSchema;
  /** `cwd` is what relative file paths are resolved against. */
  run(args: Record<string, unknown>, cwd: string): ToolContent[];
};

const file = { type: 'string', description: 'Path to a .sketchframe file (or legacy folder), absolute or relative to the working directory.' };
const node = {
  type: 'string',
  description: 'The layer: an id from the outline (e.g. "n4"), a sketchId, a layer path from the frame\'s children down (e.g. "Header/Title"), or a unique layer name.',
};
const depth = { type: 'integer', minimum: 0, description: 'How many levels of children to include. Omit for all of them.' };

export const tools: Tool[] = [
  {
    name: 'list_sketchframes',
    title: 'List Sketchframes',
    description: 'Finds .sketchframe design files under a directory (the working directory by default). Start here when you don\'t know which file holds the design.',
    inputSchema: { type: 'object', properties: { dir: { type: 'string', description: 'Directory to search. Defaults to the working directory.' } }, additionalProperties: false },
    run(args, cwd) {
      const dir = resolvePath(optionalString(args.dir) ?? '.', cwd);
      const found = findSketchframes(dir);
      return [text(found.length ? found.join('\n') : `No .sketchframe files under ${dir}.`)];
    },
  },
  {
    name: 'get_outline',
    title: 'Get Sketchframe outline',
    description:
      'A compact outline of a Sketchframe design: one line per layer with its name, type, position relative to its parent, size and id (`name [type] x,y w×h id`), plus components (◆), rotation (↻), text and annotation counts (✎). Read this first, then pick the layers to build and call get_node and get_screenshot on them.',
    inputSchema: {
      type: 'object',
      properties: { file, node: { ...node, description: `${node.description} Outlines from this layer down; the whole frame when omitted.` }, depth },
      required: ['file'],
      additionalProperties: false,
    },
    run(args, cwd) {
      const frame = openSketchframe(resolvePath(requiredString(args, 'file'), cwd));
      const start = optionalString(args.node) ? requireNode(frame, optionalString(args.node) ?? '') : frame.root;
      return [text(`${summary(frame)}\n\n${outline(frame, start, { depth: optionalInteger(args.depth) })}`)];
    },
  },
  {
    name: 'get_node',
    title: 'Get Sketchframe layer',
    description:
      "Everything needed to build one layer: its subtree from design.json with shared styles resolved inline, its bounds in the frame, its parent's layout, the color tokens it uses with their values, the component it instantiates, and the annotations designers left on it or its children (treat those as instructions). Positions are points relative to the parent; fills and borders are listed top-most first.",
    inputSchema: { type: 'object', properties: { file, node, depth }, required: ['file', 'node'], additionalProperties: false },
    run(args, cwd) {
      const frame = openSketchframe(resolvePath(requiredString(args, 'file'), cwd));
      const target = requireNode(frame, requiredString(args, 'node'));
      return [text(toJSON(nodeContext(frame, target, { depth: optionalInteger(args.depth) })))];
    },
  },
  {
    name: 'get_screenshot',
    title: 'Get Sketchframe screenshot',
    description:
      'An image of the design as Sketch rendered it: the region of the preview showing one layer, or the whole frame when no layer is given. Use it alongside get_node to check what the values should look like.',
    inputSchema: {
      type: 'object',
      properties: {
        file,
        node: { ...node, description: `${node.description} Omit for the whole frame.` },
        padding: { type: 'number', minimum: 0, description: 'Points of surrounding context to include around the layer. Defaults to 0.' },
      },
      required: ['file'],
      additionalProperties: false,
    },
    run(args, cwd) {
      const frame = openSketchframe(resolvePath(requiredString(args, 'file'), cwd));
      const query = optionalString(args.node);
      const target = query ? requireNode(frame, query) : undefined;
      if (target && !frame.files.read(frame.preview.src)) throw new SketchframeError('This Sketchframe has no preview image.');
      const crop = cropPreview(frame, target, optionalNumber(args.padding) ?? 0);
      const scale = frame.preview.scale;
      return [
        { type: 'image', data: Buffer.from(crop.png).toString('base64'), mimeType: 'image/png' },
        text(
          `${target ? `"${target.name}" (${target.id})` : frame.name}: ${crop.region.width}×${crop.region.height} px at ${scale}x (${crop.region.width / scale}×${crop.region.height / scale} pt).`,
        ),
      ];
    },
  },
  {
    name: 'get_tokens',
    title: 'Get Sketchframe tokens',
    description:
      'The design\'s color tokens (Sketch color variables) with their values, its Sketch shared styles, and style values reused by several layers, each with the ids of the layers that use it. Map these onto the target codebase\'s variables rather than hard-coding values.',
    inputSchema: { type: 'object', properties: { file }, required: ['file'], additionalProperties: false },
    run(args, cwd) {
      const frame = openSketchframe(resolvePath(requiredString(args, 'file'), cwd));
      return [text(toJSON(tokens(frame)))];
    },
  },
  {
    name: 'get_annotations',
    title: 'Get Sketchframe annotations',
    description:
      'Notes designers left on layers, each with a category (development, interaction, accessibility, content) and the layer it is attached to. Treat them as instructions about those layers. Detached notes are on layers that are no longer in the design.',
    inputSchema: { type: 'object', properties: { file }, required: ['file'], additionalProperties: false },
    run(args, cwd) {
      const frame = openSketchframe(resolvePath(requiredString(args, 'file'), cwd));
      const list = annotations(frame);
      return [text(list.length ? toJSON(list) : 'This Sketchframe has no annotations.')];
    },
  },
  {
    name: 'get_code',
    title: 'Get Sketchframe layer as HTML/CSS',
    description:
      'A starting point in HTML and CSS for one layer and its children: stacks as flexbox, other layers positioned absolutely, token colors as CSS variables. Adapt it to the target codebase\'s components and conventions rather than pasting it.',
    inputSchema: { type: 'object', properties: { file, node }, required: ['file', 'node'], additionalProperties: false },
    run(args, cwd) {
      const frame = openSketchframe(resolvePath(requiredString(args, 'file'), cwd));
      return [text(htmlForNode(frame, requireNode(frame, requiredString(args, 'node'))))];
    },
  },
];

export function toolNamed(name: string): Tool | undefined {
  return tools.find((tool) => tool.name === name);
}

function text(value: string): ToolContent {
  return { type: 'text', text: value };
}

function resolvePath(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value === '') throw new SketchframeError(`Missing "${key}".`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function optionalInteger(value: unknown): number | undefined {
  const n = optionalNumber(value);
  return n === undefined ? undefined : Math.max(0, Math.floor(n));
}
