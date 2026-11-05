import SwiftUI
import AppKit

/// The zoomable preview image with highlight outlines and annotation badges.
struct CanvasView: View {
    let package: SketchframePackage
    let previewImage: NSImage?
    let annotations: [SketchframeAnnotation]
    let showsAnnotationBadges: Bool
    @Bindable var state: ViewerState

    @State private var magnificationBase: CGFloat?
    /// The layer under the pointer, so the context menu can offer to annotate
    /// whatever was right-clicked (SwiftUI doesn't give the click location).
    @State private var pointerNodeID: SketchframeNode.ID?

    private let margin: CGFloat = 24

    var body: some View {
        GeometryReader { geometry in
            let imageSize = package.previewSize
            let fitScale = max(
                min(
                    (geometry.size.width - margin * 2) / max(imageSize.width, 1),
                    (geometry.size.height - margin * 2) / max(imageSize.height, 1),
                    2
                ),
                ViewerState.zoomRange.lowerBound
            )
            let scale = state.zoom ?? fitScale

            ScrollView([.horizontal, .vertical]) {
                artboard(scale: scale)
                    .frame(width: imageSize.width * scale, height: imageSize.height * scale)
                    .padding(margin)
                    .frame(minWidth: geometry.size.width, minHeight: geometry.size.height)
            }
            .scrollIndicators(state.zoom == nil ? .never : .automatic)
            .onChange(of: fitScale, initial: true) { _, newValue in
                state.fitScale = newValue
            }
            .simultaneousGesture(
                MagnifyGesture()
                    .onChanged { value in
                        let base = magnificationBase ?? state.scale
                        magnificationBase = base
                        state.zoom = min(
                            max(base * value.magnification, ViewerState.zoomRange.lowerBound),
                            ViewerState.zoomRange.upperBound
                        )
                    }
                    .onEnded { _ in magnificationBase = nil }
            )
        }
        .background(Color(nsColor: .underPageBackgroundColor))
    }

    private func artboard(scale: CGFloat) -> some View {
        let offset = package.frameOrigin
        func point(_ p: CGPoint) -> CGPoint {
            CGPoint(x: (p.x + offset.x) * scale, y: (p.y + offset.y) * scale)
        }

        return ZStack(alignment: .topLeading) {
            if let previewImage {
                Image(nsImage: previewImage)
                    .resizable()
                    .interpolation(.high)
            } else {
                Rectangle()
                    .fill(.quaternary)
                    .overlay { Text("No preview").foregroundStyle(.secondary) }
            }

            // The selection keeps a solid outline; whatever is hovered gets a
            // dashed one on top, so both are visible at once.
            let selected = nodes(for: state.selection)
            let selectedIDs = Set(selected.map(\.id))
            ForEach(selected) { node in
                let outline = outline(of: node, point: point)
                ZStack {
                    outline.fill(Color.accentColor.opacity(0.12))
                    outline.stroke(Color.accentColor, lineWidth: 1.5)
                }
                .allowsHitTesting(false)
            }
            ForEach(nodes(for: state.hovered).filter { !selectedIDs.contains($0.id) }) { node in
                outline(of: node, point: point)
                    .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 1.5, dash: [5, 3]))
                    .allowsHitTesting(false)
            }

            if showsAnnotationBadges {
                ForEach(Array(annotations.enumerated()), id: \.element.id) { index, annotation in
                    if let node = package.node(for: annotation) {
                        AnnotationBadge(number: index + 1, category: annotation.category)
                            .position(point(node.corners[0]))
                            .onTapGesture {
                                state.selectedAnnotationID = annotation.id
                                state.selectedNodeID = node.id
                                state.sidebarMode = .annotations
                                state.isSidebarShown = true
                            }
                            .onHover { isHovering in
                                state.hovered = isHovering ? .annotation(annotation.id) : nil
                            }
                            .help(annotation.text)
                    }
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(coordinateSpace: .local) { location in
            state.hovered = nil
            state.selectLayer(layer(at: location, scale: scale)?.id)
        }
        .onContinuousHover(coordinateSpace: .local) { phase in
            switch phase {
            case .active(let location):
                // Kept when the pointer leaves: opening the menu ends the hover.
                let id = layer(at: location, scale: scale)?.id
                if id != pointerNodeID { pointerNodeID = id }
                // The layer under the pointer gets the dashed outline. This
                // also replaces anything a sidebar row left behind, but not a
                // badge's `.annotation`, which is hovered on top of the canvas.
                let target = id.map(HighlightTarget.node)
                if state.hovered?.isAnnotation != true, state.hovered != target { state.hovered = target }
            case .ended:
                if case .node = state.hovered { state.hovered = nil }
            }
        }
        .contextMenu {
            if let node = pointerNodeID.flatMap(package.node(withID:)) {
                if state.canEditAnnotations {
                    Button("Add Annotation to “\(node.displayName)”") {
                        state.beginAnnotation(on: node.id)
                    }
                }
                Button("Select “\(node.displayName)”") {
                    state.showInLayers(node.id)
                }
            }
        }
    }

    /// The deepest layer under a point in the artboard's (scaled) space.
    private func layer(at location: CGPoint, scale: CGFloat) -> SketchframeNode? {
        let offset = package.frameOrigin
        return package.hitTest(CGPoint(x: location.x / scale - offset.x, y: location.y / scale - offset.y))
    }

    /// Traced through the node's transformed corners so the outline follows
    /// rotated and flipped layers.
    private func outline(of node: SketchframeNode, point: (CGPoint) -> CGPoint) -> Path {
        Path { path in
            path.addLines(node.corners.map(point))
            path.closeSubpath()
        }
    }

    /// The frame layers to outline for a highlight. Anything inside a
    /// component definition outlines that component's instances instead.
    private func nodes(for target: HighlightTarget?) -> [SketchframeNode] {
        switch target {
        case .node(let id), .component(let id):
            if let component = package.component(containing: id) { return component.instances }
            return package.node(withID: id).map { [$0] } ?? []
        case .style(let id):
            return (package.style(withID: id)?.nodeIDs ?? []).compactMap(package.node(withID:))
        case .token(let name):
            return (package.colorToken(named: name)?.nodeIDs ?? []).compactMap(package.node(withID:))
        case .annotation(let id):
            return annotations.first { $0.id == id }.flatMap(package.node(for:)).map { [$0] } ?? []
        case nil:
            return []
        }
    }
}

/// The numbered pin shown on an annotated layer's top-left corner.
struct AnnotationBadge: View {
    let number: Int
    let category: AnnotationCategory

    var body: some View {
        Text("\(number)")
            .font(.caption2.bold())
            .monospacedDigit()
            .foregroundStyle(.white)
            .frame(minWidth: 18, minHeight: 18)
            .padding(.horizontal, number > 9 ? 3 : 0)
            .background(Capsule().fill(category.color))
            .overlay(Capsule().strokeBorder(.white, lineWidth: 1.5))
            .shadow(color: .black.opacity(0.25), radius: 2, y: 1)
    }
}

extension AnnotationCategory {
    var color: Color {
        switch self {
        case .development: .blue
        case .interaction: .purple
        case .accessibility: .green
        case .content: .orange
        }
    }
}
