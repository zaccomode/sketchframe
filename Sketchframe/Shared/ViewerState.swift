import SwiftUI
import Observation

enum SidebarMode: Hashable {
    case inspector
    case annotations
}

enum InspectorTab: Int, CaseIterable, Identifiable {
    case layers
    case components
    case styles
    case tokens

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .layers: "Layers"
        case .components: "Components"
        case .styles: "Shared Styles"
        case .tokens: "Color Tokens"
        }
    }

    var symbolName: String {
        switch self {
        case .layers: "square.3.layers.3d"
        case .components: "diamond"
        case .styles: "paintbrush.pointed"
        case .tokens: "paintpalette"
        }
    }
}

/// What the canvas outlines: a layer, or everything using a component,
/// style or token, or an annotation's layer.
enum HighlightTarget: Hashable {
    case node(SketchframeNode.ID)
    case component(SketchframeNode.ID)
    case style(SketchframeStyle.ID)
    case token(String)
    case annotation(SketchframeAnnotation.ID)

    var isAnnotation: Bool {
        if case .annotation = self { true } else { false }
    }
}

/// An annotation being written or edited in the sidebar.
struct AnnotationDraft: Equatable {
    /// `nil` for a new annotation.
    var annotationID: SketchframeAnnotation.ID?
    var nodeID: SketchframeNode.ID
    var category: AnnotationCategory = .development
    var text = ""
}

/// Per-window viewer state, shared with the menu bar through
/// `FocusedValues.viewerState`.
@MainActor
@Observable
final class ViewerState {
    // Changing what the sidebar shows removes the row under the pointer
    // without an "exit" hover event, so drop any hover it left behind.
    var isSidebarShown = true {
        didSet { if isSidebarShown != oldValue { hovered = nil } }
    }
    var sidebarMode: SidebarMode = .inspector {
        didSet { if sidebarMode != oldValue { hovered = nil } }
    }
    var inspectorTab: InspectorTab = .layers {
        didSet { if inspectorTab != oldValue { hovered = nil } }
    }

    /// `nil` fits the preview to the window.
    var zoom: CGFloat?
    /// The scale that fits the preview in the window, kept up to date by the canvas.
    var fitScale: CGFloat = 1

    /// The layer selected on the canvas or in the Layers tab.
    var selectedNodeID: SketchframeNode.ID?
    /// A component root or a layer inside a component definition.
    var selectedComponentNodeID: SketchframeNode.ID?
    var selectedStyleID: SketchframeStyle.ID?
    var selectedTokenName: String?
    var selectedAnnotationID: SketchframeAnnotation.ID?
    var hovered: HighlightTarget?
    /// Expanded rows in the Layers and Components trees (node ids are unique
    /// across both).
    var expandedNodeIDs: Set<SketchframeNode.ID>

    var draft: AnnotationDraft?
    /// Annotations can only be written where the package can be saved (not
    /// in Quick Look).
    let canEditAnnotations: Bool

    init(canEditAnnotations: Bool, expandedNodeIDs: Set<SketchframeNode.ID> = []) {
        self.canEditAnnotations = canEditAnnotations
        self.expandedNodeIDs = expandedNodeIDs
    }

    // MARK: Zoom

    static let zoomRange: ClosedRange<CGFloat> = 0.1...8
    private static let zoomStep: CGFloat = 1.25

    var scale: CGFloat { zoom ?? fitScale }

    func zoomIn() { zoom = min(scale * Self.zoomStep, Self.zoomRange.upperBound) }
    func zoomOut() { zoom = max(scale / Self.zoomStep, Self.zoomRange.lowerBound) }
    func zoomToActualSize() { zoom = 1 }
    func zoomToFit() { zoom = nil }

    // MARK: Sidebar

    func isShowing(_ mode: SidebarMode) -> Bool {
        isSidebarShown && sidebarMode == mode
    }

    /// Shows `mode` in the sidebar, or hides the sidebar if it's already showing.
    func toggle(_ mode: SidebarMode) {
        if isShowing(mode) {
            isSidebarShown = false
        } else {
            sidebarMode = mode
            isSidebarShown = true
        }
    }

    // MARK: Selection

    /// Hovered items win; otherwise the selection that belongs to whatever
    /// the sidebar is showing.
    var highlight: HighlightTarget? {
        if let hovered { return hovered }
        guard isSidebarShown else { return selectedNodeID.map(HighlightTarget.node) }
        switch sidebarMode {
        case .annotations:
            if let draft { return .node(draft.nodeID) }
            if let selectedAnnotationID { return .annotation(selectedAnnotationID) }
            return selectedNodeID.map(HighlightTarget.node)
        case .inspector:
            switch inspectorTab {
            case .layers: return selectedNodeID.map(HighlightTarget.node)
            case .components: return selectedComponentNodeID.map(HighlightTarget.component)
            case .styles: return selectedStyleID.map(HighlightTarget.style)
            case .tokens: return selectedTokenName.map(HighlightTarget.token)
            }
        }
    }

    /// Selects a layer from the canvas and shows it in the sidebar.
    func selectLayer(_ id: SketchframeNode.ID?) {
        selectedNodeID = id
        selectedAnnotationID = nil
        if isShowing(.inspector) { inspectorTab = .layers }
    }

    /// Selects a layer and opens the inspector's Layers tab on it, whatever
    /// the sidebar was showing.
    func showInLayers(_ id: SketchframeNode.ID) {
        selectLayer(id)
        sidebarMode = .inspector
        isSidebarShown = true
        inspectorTab = .layers
    }

    // MARK: Annotations

    func beginAnnotation(on nodeID: SketchframeNode.ID) {
        guard canEditAnnotations else { return }
        selectedNodeID = nodeID
        draft = AnnotationDraft(nodeID: nodeID)
        sidebarMode = .annotations
        isSidebarShown = true
    }

    func beginEditing(_ annotation: SketchframeAnnotation, nodeID: SketchframeNode.ID) {
        guard canEditAnnotations else { return }
        selectedAnnotationID = annotation.id
        draft = AnnotationDraft(
            annotationID: annotation.id,
            nodeID: nodeID,
            category: annotation.category,
            text: annotation.text
        )
    }
}

extension FocusedValues {
    @Entry var viewerState: ViewerState?
}
