import { hash } from "./utils/hash";

// Style fields that are worth sharing between nodes, and their key prefixes.
const SHARED_FIELDS = {
  fills: "fill",
  borders: "border",
  effects: "effect",
  corners: "corner",
  layout: "layout",
  textStyle: "text",
};

function visit(node, fn) {
  fn(node);
  (node.children || []).forEach((child) => visit(child, fn));
}

// Moves any style value used by two or more nodes into a top-level `styles`
// map and replaces it on the node with its key (e.g. "fill_9d1e44a0").
// Values used once stay inline, so the payload never grows. `roots` is the
// frame plus each component's root.
export function extractSharedStyles(roots) {
  const visitAll = (fn) => roots.forEach((root) => visit(root, fn));
  const counts = {};
  visitAll((node) => {
    Object.keys(SHARED_FIELDS).forEach((field) => {
      if (node[field] === undefined) return;
      const signature = field + JSON.stringify(node[field]);
      counts[signature] = (counts[signature] || 0) + 1;
    });
  });

  const styles = {};
  const keys = {};
  visitAll((node) => {
    Object.keys(SHARED_FIELDS).forEach((field) => {
      if (node[field] === undefined) return;
      const json = JSON.stringify(node[field]);
      const signature = field + json;
      if (counts[signature] < 2) return;
      if (!keys[signature]) {
        let key = `${SHARED_FIELDS[field]}_${hash(json)}`;
        while (styles[key]) key += "_";
        keys[signature] = key;
        styles[key] = node[field];
      }
      node[field] = keys[signature];
    });
  });
  return styles;
}

// One line per node, indented by depth, so an agent can see the whole
// structure before reading the full tree:
//   "  Card [frame] 16,120 343×96 n4"
export function buildOutline(root) {
  const lines = [];
  const walk = (node, depth) => {
    const position = node.x === undefined ? "" : ` ${node.x},${node.y}`;
    lines.push(
      `${"  ".repeat(depth)}${node.name} [${node.type}]${position} ${node.width}×${node.height} ${node.id}`,
    );
    (node.children || []).forEach((child) => walk(child, depth + 1));
  };
  walk(root, 0);
  return lines;
}
