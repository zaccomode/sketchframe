// annotations.json: notes people leave on layers. See docs/FORMAT.md.

import { isObject, prettyJSON, string } from './format.ts';

export const annotationCategories = ['development', 'interaction', 'accessibility', 'content'] as const;
export type AnnotationCategory = (typeof annotationCategories)[number];

export type SketchframeAnnotation = {
  id: string;
  /** The node's `id` when the note was written; renumbered on re-export. */
  nodeId: string;
  sketchId?: string;
  layerPath: string[];
  layerName: string;
  category: AnnotationCategory;
  text: string;
  createdAt: string;
  updatedAt?: string;
};

/** The parts of a node that annotations are matched against. */
export type AnnotatableNode = { id: string; sketchId?: string; name: string; path: string[] };

/** Unreadable files read as no annotations; unknown categories read as `content`. */
export function parseAnnotations(text: string | null | undefined): SketchframeAnnotation[] {
  if (!text) return [];
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isObject(file) || !Array.isArray(file.annotations)) return [];
  return file.annotations.flatMap((value): SketchframeAnnotation[] => {
    if (!isObject(value)) return [];
    const id = string(value.id);
    const nodeId = string(value.nodeId);
    const text = string(value.text);
    const createdAt = string(value.createdAt);
    if (id === undefined || nodeId === undefined || text === undefined || createdAt === undefined) return [];
    const category = annotationCategories.find((category) => category === value.category) ?? 'content';
    return [
      {
        id,
        nodeId,
        sketchId: string(value.sketchId),
        layerPath: Array.isArray(value.layerPath) ? value.layerPath.filter((name) => typeof name === 'string') : [],
        layerName: string(value.layerName) ?? '',
        category,
        text,
        createdAt,
        updatedAt: string(value.updatedAt),
      },
    ];
  });
}

/**
 * annotations.json's text, matching the Mac app: sorted keys, and dates
 * without fractional seconds, which Swift's `.iso8601` decoder rejects.
 */
export function annotationsFileText(annotations: SketchframeAnnotation[]): string {
  return `${prettyJSON({ version: 1, annotations })}\n`;
}

/** `2026-11-03T11:20:00Z`: ISO 8601 to the second, as the Mac app writes it. */
export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The frame layer an annotation belongs to: by Sketch ID, then by layer path,
 * then by the node id it was written against (if the name still matches).
 * `undefined` if the layer is gone. `nodes` are the frame's nodes, depth first.
 */
export function annotatedNode<N extends AnnotatableNode>(nodes: N[], annotation: SketchframeAnnotation): N | undefined {
  if (annotation.sketchId) {
    const node = nodes.find((node) => node.sketchId === annotation.sketchId);
    if (node) return node;
  }
  if (annotation.layerPath.length > 0) {
    const key = JSON.stringify(annotation.layerPath);
    const node = nodes.find((node) => JSON.stringify(node.path) === key);
    if (node) return node;
  }
  const node = nodes.find((node) => node.id === annotation.nodeId);
  return node?.name === annotation.layerName ? node : undefined;
}
