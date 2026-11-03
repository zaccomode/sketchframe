import SwiftUI
import AppKit

/// The preview image beside the layer tree. Hovering or selecting a layer
/// outlines it on the image; clicking the image selects the layer under the
/// pointer. The Components tab lists the symbols the frame uses; selecting
/// one outlines all of its instances.
struct SketchframeView: View {
    private enum SidebarTab: Hashable {
        case layers
        case components
    }

    let package: SketchframePackage
    private let previewImage: NSImage?

    @State private var tab: SidebarTab = .layers
    /// A node in the frame or in a component definition.
    @State private var selection: SketchframeNode.ID?
    @State private var hovered: SketchframeNode.ID?

    init(package: SketchframePackage) {
        self.package = package
        self.previewImage = package.previewData.flatMap(NSImage.init(data:))
    }

    var body: some View {
        // A fixed-width sidebar keeps the focus on the image; HSplitView
        // splits the space evenly and ignores ideal widths.
        HStack(spacing: 0) {
            canvas
                .frame(minWidth: 240, maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            inspector
                .frame(width: 280)
                .frame(maxHeight: .infinity)
        }
    }

    // MARK: Canvas

    private var canvas: some View {
        GeometryReader { geometry in
            let imageSize = package.previewSize
            let available = CGSize(
                width: max(geometry.size.width - 32, 1),
                height: max(geometry.size.height - 32, 1)
            )
            let scale = min(
                available.width / max(imageSize.width, 1),
                available.height / max(imageSize.height, 1),
                2
            )
            let offset = package.frameOrigin

            ZStack(alignment: .topLeading) {
                if let previewImage {
                    Image(nsImage: previewImage)
                        .resizable()
                        .interpolation(.high)
                } else {
                    Rectangle()
                        .fill(.quaternary)
                        .overlay { Text("No preview").foregroundStyle(.secondary) }
                }

                ForEach(highlightedNodes) { node in
                    // Traced through the node's transformed corners so the
                    // outline follows rotated and flipped layers.
                    let outline = Path { path in
                        path.addLines(node.corners.map {
                            CGPoint(x: ($0.x + offset.x) * scale, y: ($0.y + offset.y) * scale)
                        })
                        path.closeSubpath()
                    }
                    ZStack {
                        outline.fill(Color.accentColor.opacity(0.12))
                        outline.stroke(Color.accentColor, lineWidth: 1.5)
                    }
                    .allowsHitTesting(false)
                }
            }
            .frame(width: imageSize.width * scale, height: imageSize.height * scale)
            .contentShape(Rectangle())
            .onTapGesture(coordinateSpace: .local) { location in
                let point = CGPoint(
                    x: location.x / scale - offset.x,
                    y: location.y / scale - offset.y
                )
                selection = package.hitTest(point)?.id
                tab = .layers
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .background(Color(nsColor: .underPageBackgroundColor))
    }

    /// A layer in the frame outlines itself; a component (or any layer inside
    /// its definition) outlines every instance of it.
    private var highlightedNodes: [SketchframeNode] {
        guard let id = hovered ?? selection else { return [] }
        if let component = package.component(containing: id) { return component.instances }
        return package.node(withID: id).map { [$0] } ?? []
    }

    // MARK: Inspector

    private var inspector: some View {
        VStack(spacing: 0) {
            header
            if !package.components.isEmpty {
                Picker("View", selection: $tab) {
                    Text("Layers").tag(SidebarTab.layers)
                    Text("Components").tag(SidebarTab.components)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
            }
            Divider()
            VSplitView {
                Group {
                    switch tab {
                    case .layers:
                        tree([package.root])
                    case .components:
                        tree(package.components.map(\.root))
                    }
                }
                .frame(minHeight: 160)

                VStack(spacing: 0) {
                    if let relation = selectionRelation {
                        relation
                        Divider()
                    }
                    ScrollView {
                        Text(selectedNode.details)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                    }
                }
                .frame(minHeight: 120, idealHeight: 240)
            }
        }
    }

    private func tree(_ roots: [SketchframeNode]) -> some View {
        List(roots, children: \.children, selection: $selection) { node in
            row(for: node)
                .onHover { isHovering in
                    if isHovering {
                        hovered = node.id
                    } else if hovered == node.id {
                        hovered = nil
                    }
                }
        }
        .listStyle(.sidebar)
    }

    @ViewBuilder
    private func row(for node: SketchframeNode) -> some View {
        let label = Label(node.name.isEmpty ? node.type : node.name, systemImage: icon(for: node.type))
            .lineLimit(1)
        if let component = package.components.first(where: { $0.root.id == node.id }) {
            VStack(alignment: .leading, spacing: 1) {
                label
                Text(componentCaption(component))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .padding(.leading, 24)
            }
        } else {
            label.help("\(node.type) · \(format(node.size.width))×\(format(node.size.height))")
        }
    }

    /// Links an instance to its component definition, and a component to its
    /// instances.
    private var selectionRelation: AnyView? {
        guard let id = selection else { return nil }

        if let component = package.component(containing: id) {
            return AnyView(relationBar {
                Text(componentCaption(component))
                    .foregroundStyle(.secondary)
                Spacer()
                if !component.instances.isEmpty {
                    Menu("Show Instance") {
                        ForEach(component.instances) { instance in
                            Button(instance.name) {
                                tab = .layers
                                selection = instance.id
                            }
                        }
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                }
            })
        }

        if let componentID = package.node(withID: id)?.componentID,
           let component = package.component(withID: componentID) {
            return AnyView(relationBar {
                Text("Instance of \(Text(component.name).bold())")
                Spacer()
                Button("Show Component") {
                    tab = .components
                    selection = component.root.id
                }
                .buttonStyle(.borderless)
            })
        }

        return nil
    }

    private func relationBar<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 6) {
            content()
        }
        .font(.caption)
        .lineLimit(1)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private func componentCaption(_ component: SketchframeComponent) -> String {
        var parts = [counted(component.instances.count, "instance")]
        if let library = component.library { parts.append(library) }
        return parts.joined(separator: " · ")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(package.name)
                .font(.headline)
                .lineLimit(1)
            Text(summary)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
    }

    private var summary: String {
        var parts = [
            "\(format(package.root.size.width))×\(format(package.root.size.height))",
            counted(package.nodeCount, "layer"),
        ]
        if !package.components.isEmpty { parts.append(counted(package.components.count, "component")) }
        if package.styleCount > 0 { parts.append(counted(package.styleCount, "shared style")) }
        if package.tokenCount > 0 { parts.append(counted(package.tokenCount, "color token")) }
        return parts.joined(separator: " · ")
    }

    /// "1 layer", "9 layers".
    private func counted(_ count: Int, _ noun: String) -> String {
        "\(count) \(noun)\(count == 1 ? "" : "s")"
    }

    private var selectedNode: SketchframeNode {
        selection.flatMap(package.node(withID:)) ?? package.root
    }

    private func icon(for type: String) -> String {
        switch type {
        case "frame": "square.dashed"
        case "graphic": "square.on.circle"
        case "group": "folder"
        case "instance": "diamond"
        case "text": "textformat"
        case "image": "photo"
        case "rectangle": "rectangle"
        case "oval": "circle"
        case "vector": "scribble"
        default: "square"
        }
    }

    private func format(_ value: CGFloat) -> String {
        value.rounded() == value ? String(Int(value)) : String(format: "%.1f", value)
    }
}
