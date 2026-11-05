// The viewer: the preview canvas on the left, and a sidebar on the right
// showing either the inspector or the annotations, laid out like the Mac app.
// Rendering is plain DOM; state changes call render() (or one of its parts),
// which is cheap enough for the size of trees Sketch exports.

import '@vscode/codicons/dist/codicon.css';
import './style.css';
import type { HostMessage, ViewerCommand, ViewerSettings, WebviewMessage } from '../src/protocol.ts';
import { highlightJSON } from './json.ts';
import {
  allNodes,
  ancestorIds,
  annotationCategories,
  corners,
  hitTest,
  isoNow,
  newAnnotation,
  nodeForAnnotation,
  nodeWithId,
  outline,
  parsePackage,
  SketchframeError,
} from './model.ts';
import type { AnnotationCategory, SketchframeAnnotation, SketchframeNode, SketchframePackage } from './model.ts';
import { svgPath } from './outline.ts';
import { tokenSections } from './properties.ts';
import type { PropertyRow, PropertySection } from './properties.ts';

type VSCodeAPI = {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};
declare function acquireVsCodeApi(): VSCodeAPI;

const vscode = acquireVsCodeApi();

const tabs = [
  { id: 'layers', title: 'Layers' },
  { id: 'components', title: 'Components' },
  { id: 'styles', title: 'Shared Styles' },
  { id: 'tokens', title: 'Color Tokens' },
] as const;
type Tab = (typeof tabs)[number]['id'];
type SidebarMode = 'inspector' | 'annotations';
/** How the details pane shows the selection: grouped properties, or the raw JSON. */
type DetailsMode = 'gui' | 'json';

/** What the canvas outlines: one layer, or every layer using something. */
type Highlight = { nodes: SketchframeNode[] };

/** An annotation being written (no `annotationId`) or edited. */
type Draft = { annotationId?: string; nodeId: string; category: AnnotationCategory; text: string };

/** Survives the tab being hidden and VS Code restarting. */
type SavedState = {
  zoom: number | null;
  tab: Tab;
  sidebarShown: boolean;
  sidebarMode: SidebarMode;
  sidebarWidth: number;
  listHeight: number | null;
  detailsMode: DetailsMode;
};

const zoomRange = { min: 0.1, max: 8 };
const zoomStep = 1.25;
const sidebarRange = { min: 220, max: 640 };

const saved = (vscode.getState() ?? {}) as Partial<SavedState>;
const state = {
  pkg: undefined as SketchframePackage | undefined,
  previewUrl: '',
  error: undefined as string | undefined,
  canEditAnnotations: false,
  settings: { wordWrap: false, jsonColors: {} } as ViewerSettings,
  /** `null` fits the preview to the canvas. */
  zoom: saved.zoom ?? null,
  fitScale: 1,
  tab: saved.tab ?? ('layers' as Tab),
  sidebarShown: saved.sidebarShown ?? true,
  sidebarMode: saved.sidebarMode ?? ('inspector' as SidebarMode),
  sidebarWidth: saved.sidebarWidth ?? 300,
  listHeight: saved.listHeight ?? null,
  detailsMode: saved.detailsMode ?? ('gui' as DetailsMode),
  /** Selection per tab, like the Mac app keeps one per list. */
  selected: {} as Partial<Record<Tab, string>>,
  selectedAnnotationId: undefined as string | undefined,
  annotations: [] as SketchframeAnnotation[],
  draft: undefined as Draft | undefined,
  hovered: undefined as Highlight | undefined,
  expanded: new Set<string>(),
};

const scale = () => state.zoom ?? state.fitScale;
const isShowing = (mode: SidebarMode) => state.sidebarShown && state.sidebarMode === mode;

// MARK: Layout

document.body.innerHTML = `
  <main class="viewer">
    <section class="canvas-area">
      <div class="canvas" tabindex="0">
        <div class="stage">
          <img class="preview" alt="">
          <svg class="outlines" xmlns="http://www.w3.org/2000/svg"></svg>
          <div class="pins"></div>
        </div>
        <div class="message"></div>
      </div>
      <div class="zoom-controls" role="toolbar" aria-label="Zoom">
        <button class="zoom-out codicon codicon-zoom-out" title="Zoom Out (⌘-)"></button>
        <button class="zoom-level" title="Actual Size (⌘0)">100%</button>
        <button class="zoom-in codicon codicon-zoom-in" title="Zoom In (⌘=)"></button>
        <button class="zoom-fit codicon codicon-screen-full" title="Zoom to Fit (⌘9)"></button>
      </div>
    </section>
    <aside class="sidebar">
      <div class="sidebar-resizer" role="separator" aria-orientation="vertical" title="Drag to resize"></div>
      <div class="inspector">
        <nav class="tabs" role="tablist"></nav>
        <div class="list" role="tree"></div>
        <div class="splitter" role="separator" aria-orientation="horizontal"></div>
        <section class="details">
          <header>
            <span class="details-title"></span>
            <span class="details-mode" role="radiogroup" aria-label="Details view">
              <button data-mode="gui" role="radio" title="Show properties">Properties</button>
              <button data-mode="json" role="radio" title="Show JSON">JSON</button>
            </span>
            <button class="copy codicon codicon-copy" title="Copy JSON"></button>
          </header>
          <div class="properties"></div>
          <pre class="json"></pre>
        </section>
      </div>
      <div class="annotations">
        <header class="annotations-header">
          <span class="annotations-title">Annotations</span>
          <button class="add-annotation codicon codicon-add"></button>
        </header>
        <div class="annotation-list"></div>
      </div>
    </aside>
  </main>`;

const $ = <T extends Element>(selector: string) => document.querySelector(selector) as T;
const viewer = $<HTMLElement>('.viewer');
const canvas = $<HTMLElement>('.canvas');
const stage = $<HTMLElement>('.stage');
const preview = $<HTMLImageElement>('.preview');
const outlines = $<SVGSVGElement>('.outlines');
const pins = $<HTMLElement>('.pins');
const message = $<HTMLElement>('.message');
const zoomLevel = $<HTMLButtonElement>('.zoom-level');
const resizer = $<HTMLElement>('.sidebar-resizer');
const inspector = $<HTMLElement>('.inspector');
const tabBar = $<HTMLElement>('.tabs');
const list = $<HTMLElement>('.list');
const splitter = $<HTMLElement>('.splitter');
const detailsTitle = $<HTMLElement>('.details-title');
const json = $<HTMLElement>('.json');
const properties = $<HTMLElement>('.properties');
const detailsModeButtons = [...document.querySelectorAll<HTMLButtonElement>('.details-mode button')];
const copyButton = $<HTMLButtonElement>('.copy');
const annotationsTitle = $<HTMLElement>('.annotations-title');
const addAnnotationButton = $<HTMLButtonElement>('.add-annotation');
const annotationList = $<HTMLElement>('.annotation-list');

for (const tab of tabs) {
  const button = document.createElement('button');
  button.textContent = tab.title;
  button.title = tab.title;
  button.dataset.tab = tab.id;
  button.setAttribute('role', 'tab');
  button.addEventListener('click', () => {
    state.tab = tab.id;
    state.hovered = undefined;
    save();
    render();
  });
  tabBar.append(button);
}

$('.zoom-out').addEventListener('click', () => run('zoomOut'));
$('.zoom-in').addEventListener('click', () => run('zoomIn'));
$('.zoom-fit').addEventListener('click', () => run('zoomToFit'));
zoomLevel.addEventListener('click', () => run('actualSize'));
addAnnotationButton.addEventListener('click', () => beginAnnotation(state.selected.layers));
for (const button of detailsModeButtons) {
  button.addEventListener('click', () => {
    state.detailsMode = button.dataset.mode === 'json' ? 'json' : 'gui';
    save();
    renderDetails();
  });
}

// MARK: Messages

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  const data = event.data;
  switch (data.type) {
    case 'load':
      state.canEditAnnotations = data.canEditAnnotations;
      load(data.design, data.annotations, `${data.baseUri}/`, data.revision);
      break;
    case 'settings':
      applySettings(data.settings);
      break;
    case 'error':
      state.pkg = undefined;
      state.error = data.message;
      render();
      break;
    case 'command':
      run(data.command, data.nodeId);
      break;
  }
});

function load(design: string, annotations: string | null, baseUrl: string, revision: number) {
  try {
    const pkg = parsePackage(design, annotations);
    const isFirstLoad = state.pkg === undefined;
    state.pkg = pkg;
    state.annotations = pkg.annotations;
    state.error = undefined;
    state.previewUrl = `${baseUrl}${pkg.previewSrc}?v=${revision}`;
    // Node ids are renumbered on re-export, so a reload keeps only the
    // selections that still exist.
    for (const tab of ['layers', 'components'] as const) {
      const id = state.selected[tab];
      if (id && !nodeWithId(pkg, id)) delete state.selected[tab];
    }
    if (state.draft && !nodeWithId(pkg, state.draft.nodeId)) state.draft = undefined;
    if (!state.annotations.some((annotation) => annotation.id === state.selectedAnnotationId)) {
      state.selectedAnnotationId = undefined;
    }
    if (isFirstLoad) {
      state.expanded = new Set([pkg.root.id, ...pkg.components.map((component) => component.root.id)]);
    }
  } catch (error) {
    state.pkg = undefined;
    state.error = error instanceof SketchframeError ? error.message : String(error);
  }
  render();
}

function applySettings(settings: ViewerSettings) {
  state.settings = settings;
  json.classList.toggle('wrap', settings.wordWrap);
  // Colours the theme doesn't define fall back to the CSS defaults.
  for (const [kind, color] of Object.entries(settings.jsonColors)) {
    if (color) document.documentElement.style.setProperty(`--json-${kind}`, color);
    else document.documentElement.style.removeProperty(`--json-${kind}`);
  }
}

function run(command: ViewerCommand, nodeId?: string) {
  switch (command) {
    case 'zoomIn':
      zoomAround(Math.min(scale() * zoomStep, zoomRange.max));
      break;
    case 'zoomOut':
      zoomAround(Math.max(scale() / zoomStep, zoomRange.min));
      break;
    case 'actualSize':
      zoomAround(1);
      break;
    case 'zoomToFit':
      state.zoom = null;
      save();
      renderCanvas();
      break;
    case 'toggleInspector':
      toggleSidebar('inspector');
      break;
    case 'toggleAnnotations':
      toggleSidebar('annotations');
      break;
    case 'addAnnotation':
      beginAnnotation(nodeId ?? state.selected.layers);
      break;
    case 'selectLayer':
      showInLayers(nodeId);
      break;
  }
}

function save() {
  const saved: SavedState = {
    zoom: state.zoom,
    tab: state.tab,
    sidebarShown: state.sidebarShown,
    sidebarMode: state.sidebarMode,
    sidebarWidth: state.sidebarWidth,
    listHeight: state.listHeight,
    detailsMode: state.detailsMode,
  };
  vscode.setState(saved);
}

/** Shows `mode` in the sidebar, or hides the sidebar if it's already showing. */
function toggleSidebar(mode: SidebarMode) {
  if (isShowing(mode)) {
    state.sidebarShown = false;
  } else {
    state.sidebarMode = mode;
    state.sidebarShown = true;
  }
  state.hovered = undefined;
  save();
  render();
}

// MARK: Selection

/**
 * The selection that belongs to what the sidebar shows. It stays outlined
 * while other things are hovered; `state.hovered` is drawn separately.
 */
function selection(): Highlight | undefined {
  if (!state.pkg) return undefined;
  if (!state.sidebarShown) return layerHighlight(state.selected.layers);
  if (state.sidebarMode === 'annotations') {
    if (state.draft) return layerHighlight(state.draft.nodeId);
    const annotation = state.annotations.find((annotation) => annotation.id === state.selectedAnnotationId);
    if (annotation) return annotationHighlight(annotation);
    return layerHighlight(state.selected.layers);
  }
  return selectionHighlight(state.tab, state.selected[state.tab]);
}

function selectionHighlight(tab: Tab, id: string | undefined): Highlight | undefined {
  const pkg = state.pkg;
  if (!pkg || id === undefined) return undefined;
  switch (tab) {
    case 'layers':
      return layerHighlight(id);
    case 'components': {
      // A component's definition isn't on the canvas, so outline the
      // instances of whichever component the selected layer belongs to.
      const component = pkg.components.find((component) => allNodes(component.root).some((node) => node.id === id));
      return component && { nodes: component.instances };
    }
    case 'styles': {
      const style = pkg.styles.find((style) => style.id === id);
      return style && { nodes: nodesWithIds(style.nodeIds) };
    }
    case 'tokens': {
      const token = pkg.colorTokens.find((token) => token.name === id);
      return token && { nodes: nodesWithIds(token.nodeIds) };
    }
  }
}

function layerHighlight(id: string | undefined): Highlight | undefined {
  const node = id === undefined || !state.pkg ? undefined : nodeWithId(state.pkg, id);
  return node && { nodes: [node] };
}

function annotationHighlight(annotation: SketchframeAnnotation): Highlight | undefined {
  const node = state.pkg && nodeForAnnotation(state.pkg, annotation);
  return node && { nodes: [node] };
}

function nodesWithIds(ids: string[]): SketchframeNode[] {
  const pkg = state.pkg;
  if (!pkg) return [];
  return ids.flatMap((id) => nodeWithId(pkg, id) ?? []);
}

/** Selects a layer from the canvas and shows it in the sidebar. */
function selectLayer(node: SketchframeNode | undefined) {
  state.selected.layers = node?.id;
  state.selectedAnnotationId = undefined;
  state.hovered = undefined;
  if (node && state.pkg) {
    for (const id of ancestorIds(state.pkg, node.id)) state.expanded.add(id);
    if (isShowing('inspector')) state.tab = 'layers';
  }
  save();
  render();
  if (node) reveal(list, node.id);
}

/** Selects a layer and opens the inspector's Layers tab on it, whatever the sidebar was showing. */
function showInLayers(nodeId: string | undefined) {
  const node = nodeId === undefined || !state.pkg ? undefined : nodeWithId(state.pkg, nodeId);
  if (!node) return;
  state.sidebarMode = 'inspector';
  state.sidebarShown = true;
  state.tab = 'layers';
  selectLayer(node);
}

/**
 * Scrolls a row into view inside its own list only. `scrollIntoView` also
 * scrolls every scrollable ancestor, which shifted the whole viewer.
 */
function reveal(container: HTMLElement, id: string) {
  const row = container.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  const bounds = container.getBoundingClientRect();
  const rect = row.getBoundingClientRect();
  if (rect.top < bounds.top) container.scrollTop -= bounds.top - rect.top;
  else if (rect.bottom > bounds.bottom) container.scrollTop += rect.bottom - bounds.bottom;
}

// MARK: Canvas

function canvasPoint(event: MouseEvent) {
  const pkg = state.pkg;
  if (!pkg) return undefined;
  const rect = stage.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / scale() - pkg.frameOrigin.x,
    y: (event.clientY - rect.top) / scale() - pkg.frameOrigin.y,
  };
}

function nodeUnder(event: MouseEvent) {
  const point = canvasPoint(event);
  return state.pkg && point ? hitTest(state.pkg, point) : undefined;
}

/**
 * VS Code builds the webview's context menu from the `data-vscode-context`
 * of the element under the pointer, so it's kept pointing at the layer there.
 */
function setMenuContext(node: SketchframeNode | undefined) {
  const context = node
    ? { webviewSection: 'layer', nodeId: node.id, sketchframeCanAnnotate: state.canEditAnnotations }
    : {};
  stage.dataset.vscodeContext = JSON.stringify({ ...context, preventDefaultContextMenuItems: true });
}

stage.addEventListener('mousemove', (event) => {
  const node = nodeUnder(event);
  setMenuContext(node);
  const current = state.hovered;
  if (current?.nodes.length === 1 && current.nodes[0] === node) return;
  state.hovered = node && { nodes: [node] };
  renderOutlines();
});

// Captured, so the context is current before VS Code reads it.
stage.addEventListener('contextmenu', (event) => setMenuContext(nodeUnder(event)), { capture: true });

stage.addEventListener('mouseleave', () => {
  state.hovered = undefined;
  renderOutlines();
});

stage.addEventListener('click', (event) => {
  if ((event.target as Element).closest('.pin')) return;
  selectLayer(nodeUnder(event));
});

// Pinch, ⌘-scroll and Ctrl-scroll zoom around the pointer; a plain scroll pans.
canvas.addEventListener(
  'wheel',
  (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY / (event.ctrlKey && !event.metaKey ? 100 : 300));
    zoomAround(Math.min(Math.max(scale() * factor, zoomRange.min), zoomRange.max), event);
  },
  { passive: false },
);

/** Changes the zoom, keeping the point under the pointer (or the centre) still. */
function zoomAround(zoom: number, anchor?: { clientX: number; clientY: number }) {
  const view = canvas.getBoundingClientRect();
  const clientX = anchor?.clientX ?? view.left + view.width / 2;
  const clientY = anchor?.clientY ?? view.top + view.height / 2;
  const before = stage.getBoundingClientRect();
  const old = scale();
  const x = (clientX - before.left) / old;
  const y = (clientY - before.top) / old;

  state.zoom = zoom;
  save();
  renderCanvas();

  const after = stage.getBoundingClientRect();
  canvas.scrollLeft += after.left + x * zoom - clientX;
  canvas.scrollTop += after.top + y * zoom - clientY;
}

new ResizeObserver(() => renderCanvas()).observe(canvas);

function renderCanvas() {
  const pkg = state.pkg;
  stage.hidden = !pkg;
  message.hidden = !!pkg;
  if (!pkg) {
    message.textContent = state.error ?? 'Loading…';
    zoomLevel.textContent = '';
    return;
  }

  const padding = 24;
  const { width, height } = pkg.previewSize;
  state.fitScale = Math.max(
    Math.min((canvas.clientWidth - padding * 2) / width, (canvas.clientHeight - padding * 2) / height),
    zoomRange.min,
  );
  const s = scale();
  stage.style.width = `${width * s}px`;
  stage.style.height = `${height * s}px`;
  zoomLevel.textContent = `${Math.round(s * 100)}%`;
  if (preview.getAttribute('src') !== state.previewUrl) preview.src = state.previewUrl;
  // The overlay draws in the root frame's own points, so node corners need no
  // conversion; the view box shifts by the shadow overflow around the frame.
  outlines.setAttribute('viewBox', `${-pkg.frameOrigin.x} ${-pkg.frameOrigin.y} ${width} ${height}`);
  renderOutlines();
  renderPins();
}

/**
 * Solid outlines for the selection, dashed ones for hovered layers that
 * aren't selected. Each follows the layer's corners (or ellipse).
 */
function renderOutlines() {
  const selected = selection()?.nodes ?? [];
  const hovered = (state.hovered?.nodes ?? []).filter((node) => !selected.includes(node));
  const path = (node: SketchframeNode, isHover: boolean) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    element.setAttribute('d', svgPath(outline(node)));
    element.classList.toggle('hover', isHover);
    return element;
  };
  outlines.replaceChildren(...selected.map((node) => path(node, false)), ...hovered.map((node) => path(node, true)));
}

/** A numbered badge at the top-left of each annotated layer. */
function renderPins() {
  const pkg = state.pkg;
  pins.replaceChildren();
  if (!pkg) return;
  const s = scale();
  state.annotations.forEach((annotation, index) => {
    const node = nodeForAnnotation(pkg, annotation);
    if (!node) return;
    const points = corners(node);
    const x = Math.min(...points.map((p) => p.x));
    const y = Math.min(...points.map((p) => p.y));
    const pin = document.createElement('button');
    pin.className = `pin category-${annotation.category}`;
    pin.textContent = String(index + 1);
    pin.title = annotation.text;
    pin.classList.toggle('selected', annotation.id === state.selectedAnnotationId);
    pin.style.left = `${(x + pkg.frameOrigin.x) * s}px`;
    pin.style.top = `${(y + pkg.frameOrigin.y) * s}px`;
    pin.addEventListener('click', () => {
      state.sidebarMode = 'annotations';
      state.sidebarShown = true;
      state.selectedAnnotationId = annotation.id;
      save();
      render();
      reveal(annotationList, annotation.id);
    });
    pins.append(pin);
  });
}

// MARK: Sidebar

function render() {
  viewer.classList.toggle('sidebar-hidden', !state.sidebarShown);
  viewer.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
  inspector.hidden = state.sidebarMode !== 'inspector';
  $<HTMLElement>('.annotations').hidden = state.sidebarMode !== 'annotations';
  if (state.listHeight !== null) inspector.style.setProperty('--list-size', `${state.listHeight}px`);
  for (const button of tabBar.querySelectorAll<HTMLButtonElement>('button')) {
    button.setAttribute('aria-selected', String(button.dataset.tab === state.tab));
  }
  renderList();
  renderDetails();
  renderAnnotations();
  renderCanvas();
}

function renderList() {
  const pkg = state.pkg;
  list.replaceChildren();
  if (!pkg) return;
  switch (state.tab) {
    case 'layers':
      list.append(treeRow(pkg.root, 0, 'layers'));
      break;
    case 'components':
      if (pkg.components.length === 0) list.append(empty('This frame uses no components.'));
      for (const component of pkg.components) {
        const row = treeRow(component.root, 0, 'components');
        const label = row.querySelector('.name');
        if (label) label.textContent = component.library ? `${component.name} — ${component.library}` : component.name;
        list.append(row);
      }
      break;
    case 'styles':
      if (pkg.styles.length === 0) list.append(empty('This frame has no shared or reused styles.'));
      for (const style of pkg.styles) {
        const users = `${style.nodeIds.length} ${style.nodeIds.length === 1 ? 'layer' : 'layers'}`;
        const kind = style.kind === 'shared' ? 'shared' : (style.category ?? 'reused');
        list.append(flatRow(style.id, style.name, `${kind} · ${users}`, 'styles', style.nodeIds));
      }
      break;
    case 'tokens':
      if (pkg.colorTokens.length === 0) list.append(empty('This frame uses no color tokens.'));
      for (const token of pkg.colorTokens) {
        const row = flatRow(token.name, token.name, token.value, 'tokens', token.nodeIds);
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.background = token.value;
        row.prepend(swatch);
        list.append(row);
      }
      break;
  }
}

function treeRow(node: SketchframeNode, depth: number, tab: 'layers' | 'components'): HTMLElement {
  const group = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.id = node.id;
  row.setAttribute('role', 'treeitem');
  row.style.paddingLeft = `${4 + depth * 12}px`;
  row.setAttribute('aria-selected', String(state.selected[tab] === node.id));

  const twisty = document.createElement('span');
  twisty.className = 'twisty codicon';
  const expanded = state.expanded.has(node.id);
  if (node.children.length > 0) {
    twisty.classList.add(expanded ? 'codicon-chevron-down' : 'codicon-chevron-right');
    row.setAttribute('aria-expanded', String(expanded));
    twisty.addEventListener('click', (event) => {
      event.stopPropagation();
      if (expanded) state.expanded.delete(node.id);
      else state.expanded.add(node.id);
      renderList();
    });
  }
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = node.name || node.type;
  const type = document.createElement('span');
  type.className = 'type';
  type.textContent = node.type;
  row.append(twisty, name, type);

  row.addEventListener('click', () => {
    state.selected[tab] = node.id;
    state.hovered = undefined;
    render();
  });
  row.addEventListener('mouseenter', () => {
    // A component definition's layers aren't on the canvas; hovering one
    // outlines the component's instances, like selecting it does.
    state.hovered = tab === 'layers' ? layerHighlight(node.id) : selectionHighlight(tab, node.id);
    renderOutlines();
  });
  row.addEventListener('mouseleave', () => {
    state.hovered = undefined;
    renderOutlines();
  });

  group.append(row);
  if (expanded) {
    for (const child of node.children) group.append(treeRow(child, depth + 1, tab));
  }
  return group;
}

function flatRow(id: string, title: string, subtitle: string, tab: Tab, nodeIds: string[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row flat';
  row.dataset.id = id;
  row.setAttribute('aria-selected', String(state.selected[tab] === id));
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = title;
  const detail = document.createElement('span');
  detail.className = 'type';
  detail.textContent = subtitle;
  row.append(name, detail);
  row.addEventListener('click', () => {
    state.selected[tab] = id;
    state.hovered = undefined;
    render();
  });
  row.addEventListener('mouseenter', () => {
    state.hovered = { nodes: nodesWithIds(nodeIds) };
    renderOutlines();
  });
  row.addEventListener('mouseleave', () => {
    state.hovered = undefined;
    renderOutlines();
  });
  return row;
}

function empty(text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = 'empty';
  element.textContent = text;
  return element;
}

function renderDetails() {
  const pkg = state.pkg;
  const id = state.selected[state.tab];
  let title = '';
  let text = '';
  let sections: PropertySection[] = [];
  if (pkg && id !== undefined) {
    if (state.tab === 'layers' || state.tab === 'components') {
      const node = nodeWithId(pkg, id);
      title = node ? node.name || node.type : '';
      text = node?.details ?? '';
      sections = node?.sections ?? [];
    } else if (state.tab === 'styles') {
      const style = pkg.styles.find((style) => style.id === id);
      title = style?.name ?? '';
      text = style?.details ?? '';
      sections = style?.sections ?? [];
    } else {
      const token = pkg.colorTokens.find((token) => token.name === id);
      title = token?.name ?? '';
      text = token ? JSON.stringify({ name: token.name, value: token.value }, null, 2) : '';
      if (token) {
        const layers = nodesWithIds(token.nodeIds).map((node) => node.name || node.type);
        sections = tokenSections(token.name, token.value, layers);
      }
    }
  }
  const showsJSON = state.detailsMode === 'json';
  for (const button of detailsModeButtons) {
    button.setAttribute('aria-checked', String(button.dataset.mode === state.detailsMode));
  }
  json.hidden = !showsJSON;
  properties.hidden = showsJSON;
  if (!showsJSON) renderProperties(text ? sections : undefined);
  if (pkg && !title) {
    const layers = `${pkg.nodeCount} ${pkg.nodeCount === 1 ? 'layer' : 'layers'}`;
    title = `${pkg.name} · ${layers}`;
  }
  detailsTitle.textContent = title;
  json.classList.toggle('placeholder', !text);
  json.replaceChildren(text ? highlightJSON(text) : 'Select an item to see its details.');
  json.dataset.text = text;
  copyButton.disabled = !text;
}

copyButton.addEventListener('click', () => copy(json.dataset.text ?? '', copyButton));

/** Copies `text`, showing a tick on `button` for a moment. */
async function copy(text: string, button: HTMLElement) {
  await navigator.clipboard.writeText(text);
  button.classList.remove('codicon-copy');
  button.classList.add('codicon-check');
  setTimeout(() => {
    button.classList.remove('codicon-check');
    button.classList.add('codicon-copy');
  }, 1200);
}

/** The GUI view: titled groups of label/value rows, each copied by clicking it. */
function renderProperties(sections: PropertySection[] | undefined) {
  properties.replaceChildren();
  if (sections === undefined) {
    properties.append(empty('Select an item to see its details.'));
    return;
  }
  if (sections.length === 0) {
    properties.append(empty('No properties to show. Switch to JSON to see everything.'));
    return;
  }
  for (const section of sections) {
    const element = document.createElement('section');
    element.className = 'property-section';
    const heading = document.createElement('h3');
    heading.textContent = section.title;
    element.append(heading, ...section.rows.map(propertyRow));
    properties.append(element);
  }
}

function propertyRow(property: PropertyRow): HTMLElement {
  const row = document.createElement('div');
  row.className = 'property';
  row.classList.toggle('block', property.block === true);
  row.tabIndex = 0;
  row.title = `Copy “${property.value}”`;

  const label = document.createElement('span');
  label.className = 'property-label';
  label.textContent = property.label;

  const value = document.createElement('span');
  value.className = 'property-value';
  if (property.swatch && property.swatch.length > 0) {
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background =
      property.swatch.length === 1 ? property.swatch[0] : `linear-gradient(90deg, ${property.swatch.join(', ')})`;
    value.append(swatch);
  }
  const text = document.createElement('span');
  text.className = 'property-text';
  text.textContent = property.value;
  value.append(text);
  if (property.token) {
    const token = document.createElement('span');
    token.className = 'property-token';
    token.textContent = property.token;
    token.title = `Color token “${property.token}”`;
    value.append(token);
  }

  const icon = document.createElement('span');
  icon.className = 'property-copy codicon codicon-copy';
  row.append(label, value, icon);
  const action = () => copy(property.value, icon);
  row.addEventListener('click', action);
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  });
  return row;
}

// MARK: Annotations

function beginAnnotation(nodeId: string | undefined) {
  if (!state.canEditAnnotations || nodeId === undefined || !state.pkg || !nodeWithId(state.pkg, nodeId)) return;
  state.selected.layers = nodeId;
  state.selectedAnnotationId = undefined;
  state.draft = { nodeId, category: 'development', text: '' };
  state.sidebarMode = 'annotations';
  state.sidebarShown = true;
  state.hovered = undefined;
  save();
  render();
  annotationList.scrollTop = 0;
  annotationList.querySelector<HTMLTextAreaElement>('textarea')?.focus();
}

function beginEditing(annotation: SketchframeAnnotation) {
  const node = state.pkg && nodeForAnnotation(state.pkg, annotation);
  if (!state.canEditAnnotations || !node) return;
  state.selectedAnnotationId = annotation.id;
  state.draft = { annotationId: annotation.id, nodeId: node.id, category: annotation.category, text: annotation.text };
  render();
  annotationList.querySelector<HTMLTextAreaElement>('textarea')?.focus();
}

function commitDraft() {
  const draft = state.draft;
  const node = draft && state.pkg && nodeWithId(state.pkg, draft.nodeId);
  if (!draft || !node || !draft.text.trim()) return;
  const text = draft.text.trim();
  if (draft.annotationId) {
    state.annotations = state.annotations.map((annotation) =>
      annotation.id === draft.annotationId
        ? { ...annotation, category: draft.category, text, updatedAt: isoNow() }
        : annotation,
    );
    state.selectedAnnotationId = draft.annotationId;
  } else {
    const annotation = newAnnotation(node, draft.category, text);
    state.annotations = [...state.annotations, annotation];
    state.selectedAnnotationId = annotation.id;
  }
  state.draft = undefined;
  saveAnnotations();
}

function deleteAnnotation(id: string) {
  state.annotations = state.annotations.filter((annotation) => annotation.id !== id);
  if (state.selectedAnnotationId === id) state.selectedAnnotationId = undefined;
  if (state.draft?.annotationId === id) state.draft = undefined;
  saveAnnotations();
}

/** Updates the view straight away; the host writes the file. */
function saveAnnotations() {
  vscode.postMessage({ type: 'saveAnnotations', annotations: state.annotations });
  render();
}

function renderAnnotations() {
  const pkg = state.pkg;
  const count = state.annotations.length;
  annotationsTitle.textContent = count > 0 ? `Annotations (${count})` : 'Annotations';
  const selected = state.selected.layers && pkg ? nodeWithId(pkg, state.selected.layers) : undefined;
  addAnnotationButton.disabled = !state.canEditAnnotations || !selected;
  addAnnotationButton.title = !state.canEditAnnotations
    ? "This Sketchframe can't be edited"
    : selected
      ? `Add Annotation to “${selected.name || selected.type}” (⌥⌘N)`
      : 'Select a layer to annotate';

  // Re-rendering would steal focus from a draft being typed into.
  if (annotationList.contains(document.activeElement) && document.activeElement?.tagName === 'TEXTAREA') return;

  annotationList.replaceChildren();
  if (!pkg) return;
  if (state.draft && !state.draft.annotationId) annotationList.append(editor(state.draft));
  state.annotations.forEach((annotation, index) => {
    if (state.draft?.annotationId === annotation.id) annotationList.append(editor(state.draft, index + 1));
    else annotationList.append(card(annotation, index + 1));
  });
  if (count === 0 && !state.draft) {
    annotationList.append(
      empty('No annotations yet. Right-click a layer on the canvas, or select one and press +.'),
    );
  }
}

function card(annotation: SketchframeAnnotation, number: number): HTMLElement {
  const node = state.pkg && nodeForAnnotation(state.pkg, annotation);
  const element = document.createElement('article');
  element.className = 'card';
  element.dataset.id = annotation.id;
  element.classList.toggle('selected', annotation.id === state.selectedAnnotationId);
  element.classList.toggle('detached', !node);

  const header = document.createElement('header');
  const badge = document.createElement('span');
  badge.className = `badge category-${annotation.category}`;
  badge.textContent = String(number);
  const layer = document.createElement('span');
  layer.className = 'layer';
  layer.textContent = node ? node.name || node.type : `${annotation.layerName} (detached)`;
  layer.title = node ? annotation.layerPath.join(' › ') : 'This layer is no longer in the design';
  const category = document.createElement('span');
  category.className = `category category-${annotation.category}`;
  category.textContent = annotation.category;
  header.append(badge, layer, category);

  const actions = document.createElement('span');
  actions.className = 'actions';
  if (state.canEditAnnotations) {
    if (node) actions.append(iconButton('edit', 'Edit', () => beginEditing(annotation)));
    actions.append(iconButton('trash', 'Delete', () => deleteAnnotation(annotation.id)));
  }
  if (node) actions.prepend(iconButton('list-tree', 'Show in Layers', () => showInLayers(node.id)));
  header.append(actions);

  const text = document.createElement('p');
  text.className = 'text';
  text.textContent = annotation.text;
  element.append(header, text);

  element.addEventListener('click', () => {
    state.selectedAnnotationId = annotation.id;
    state.hovered = undefined;
    render();
  });
  element.addEventListener('dblclick', () => beginEditing(annotation));
  element.addEventListener('mouseenter', () => {
    state.hovered = annotationHighlight(annotation);
    renderOutlines();
  });
  element.addEventListener('mouseleave', () => {
    state.hovered = undefined;
    renderOutlines();
  });
  return element;
}

function editor(draft: Draft, number?: number): HTMLElement {
  const node = state.pkg && nodeWithId(state.pkg, draft.nodeId);
  const element = document.createElement('form');
  element.className = 'card editor';

  const header = document.createElement('header');
  const badge = document.createElement('span');
  badge.className = `badge category-${draft.category}`;
  badge.textContent = number === undefined ? '+' : String(number);
  const layer = document.createElement('span');
  layer.className = 'layer';
  layer.textContent = node ? node.name || node.type : '';
  const select = document.createElement('select');
  for (const category of annotationCategories) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category[0].toUpperCase() + category.slice(1);
    option.selected = category === draft.category;
    select.append(option);
  }
  select.addEventListener('change', () => {
    draft.category = select.value as AnnotationCategory;
    badge.className = `badge category-${draft.category}`;
  });
  header.append(badge, layer, select);

  const textarea = document.createElement('textarea');
  textarea.value = draft.text;
  textarea.placeholder = 'Add a note for developers and agents…';
  textarea.rows = 4;
  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.className = 'primary';
  saveButton.textContent = 'Save';
  saveButton.disabled = !draft.text.trim();
  textarea.addEventListener('input', () => {
    draft.text = textarea.value;
    saveButton.disabled = !draft.text.trim();
  });
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      textarea.blur();
      commitDraft();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelDraft();
    }
  });

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'secondary';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', cancelDraft);

  const buttons = document.createElement('footer');
  buttons.append(cancelButton, saveButton);
  element.append(header, textarea, buttons);
  element.addEventListener('submit', (event) => {
    event.preventDefault();
    textarea.blur();
    commitDraft();
  });
  return element;
}

function cancelDraft() {
  (document.activeElement as HTMLElement | null)?.blur();
  state.draft = undefined;
  render();
}

function iconButton(icon: string, title: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `icon codicon codicon-${icon}`;
  button.title = title;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    action();
  });
  return button;
}

// MARK: Resizing

/** The list/details split starts at half and is dragged from the splitter. */
drag(splitter, (event) => {
  const rect = inspector.getBoundingClientRect();
  const top = tabBar.getBoundingClientRect().bottom;
  state.listHeight = Math.round(Math.min(Math.max(event.clientY - top, 100), rect.bottom - top - 100));
  inspector.style.setProperty('--list-size', `${state.listHeight}px`);
});

/** The sidebar's width is dragged from its left edge. */
drag(resizer, (event) => {
  const max = Math.min(sidebarRange.max, viewer.clientWidth - 240);
  state.sidebarWidth = Math.round(Math.min(Math.max(viewer.clientWidth - event.clientX, sidebarRange.min), max));
  viewer.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
});

function drag(handle: HTMLElement, move: (event: PointerEvent) => void) {
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.classList.remove('dragging');
      save();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

render();
vscode.postMessage({ type: 'ready' });
