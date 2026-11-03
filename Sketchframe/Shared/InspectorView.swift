import SwiftUI

/// Layers, components, shared styles and color tokens, each with a details
/// pane underneath.
struct InspectorView: View {
    let package: SketchframePackage
    let annotations: [SketchframeAnnotation]
    @Bindable var state: ViewerState

    var body: some View {
        VStack(spacing: 0) {
            FillSegmentedControl(
                segments: InspectorTab.allCases.map { .init(symbolName: $0.symbolName, label: $0.title) },
                selection: Binding(
                    get: { state.inspectorTab.rawValue },
                    set: { state.inspectorTab = InspectorTab(rawValue: $0) ?? .layers }
                )
            )
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)

            Divider()

            VerticalSplit {
                list
            } bottom: {
                details
            }
        }
    }

    // MARK: Lists

    @ViewBuilder
    private var list: some View {
        switch state.inspectorTab {
        case .layers:
            ScrollViewReader { proxy in
                List(selection: $state.selectedNodeID) {
                    NodeTree(nodes: [package.root], expanded: $state.expandedNodeIDs) { node in
                        nodeLabel(node)
                            .help("\(node.type) · \(format(node.size.width))×\(format(node.size.height))")
                            .hoverHighlight(.node(node.id), in: state)
                    }
                }
                .listStyle(.sidebar)
                .revealing(state.selectedNodeID, in: package, expanded: $state.expandedNodeIDs, proxy: proxy)
            }

        case .components:
            if package.components.isEmpty {
                ContentUnavailableView(
                    "No Components",
                    systemImage: InspectorTab.components.symbolName,
                    description: Text("This frame doesn't use any symbols.")
                )
            } else {
                ScrollViewReader { proxy in
                    List(selection: $state.selectedComponentNodeID) {
                        NodeTree(nodes: package.components.map(\.root), expanded: $state.expandedNodeIDs) { node in
                            componentRow(node)
                                .hoverHighlight(.component(node.id), in: state)
                        }
                    }
                    .listStyle(.sidebar)
                    .revealing(state.selectedComponentNodeID, in: package, expanded: $state.expandedNodeIDs, proxy: proxy)
                }
            }

        case .styles:
            if package.styles.isEmpty {
                ContentUnavailableView(
                    "No Shared Styles",
                    systemImage: InspectorTab.styles.symbolName,
                    description: Text("No layers use a shared style, and no style values are reused.")
                )
            } else {
                List(selection: $state.selectedStyleID) {
                    styleSection("Shared Styles", kind: .shared)
                    styleSection("Reused Values", kind: .reused)
                }
                .listStyle(.sidebar)
            }

        case .tokens:
            if package.colorTokens.isEmpty {
                ContentUnavailableView(
                    "No Color Tokens",
                    systemImage: InspectorTab.tokens.symbolName,
                    description: Text("This frame doesn't use any color variables.")
                )
            } else {
                List(package.colorTokens, selection: $state.selectedTokenName) { token in
                    HStack(spacing: 8) {
                        ColorSwatch(css: token.value)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(token.name).lineLimit(1)
                            Text("\(token.value) · \(counted(token.nodeIDs.count, "layer"))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                    .help(token.name)
                    .hoverHighlight(.token(token.name), in: state)
                }
                .listStyle(.sidebar)
            }
        }
    }

    private func nodeLabel(_ node: SketchframeNode) -> some View {
        Label(node.displayName, systemImage: node.symbolName)
            .lineLimit(1)
    }

    @ViewBuilder
    private func componentRow(_ node: SketchframeNode) -> some View {
        if let component = package.components.first(where: { $0.root.id == node.id }) {
            VStack(alignment: .leading, spacing: 1) {
                nodeLabel(node)
                Text(componentCaption(component))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .padding(.leading, 24)
            }
        } else {
            nodeLabel(node)
        }
    }

    @ViewBuilder
    private func styleSection(_ title: String, kind: SketchframeStyle.Kind) -> some View {
        let styles = package.styles.filter { $0.kind == kind }
        if !styles.isEmpty {
            Section(title) {
                ForEach(styles) { style in
                    VStack(alignment: .leading, spacing: 1) {
                        Label(style.name, systemImage: style.symbolName)
                            .lineLimit(1)
                        Text(style.nodeIDs.isEmpty ? "Used inside components" : counted(style.nodeIDs.count, "layer"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.leading, 24)
                    }
                    .help(style.name)
                    .hoverHighlight(.style(style.id), in: state)
                }
            }
        }
    }

    // MARK: Details

    @ViewBuilder
    private var details: some View {
        switch state.inspectorTab {
        case .layers:
            let node = state.selectedNodeID.flatMap(package.node(withID:)) ?? package.root
            DetailsPane(text: node.details) { layerRelations(node) }
        case .components:
            if let node = state.selectedComponentNodeID.flatMap(package.node(withID:)) {
                DetailsPane(text: node.details) { componentRelations(node) }
            } else {
                placeholder("Select a component to see its definition.")
            }
        case .styles:
            if let style = state.selectedStyleID.flatMap(package.style(withID:)) {
                DetailsPane(text: style.details) {
                    RelationBar {
                        Text(style.kind == .shared ? "Shared style" : "Reused value")
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text("Used by \(counted(style.nodeIDs.count, "layer"))")
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                placeholder("Select a style to see its values and where it's used.")
            }
        case .tokens:
            if let token = state.selectedTokenName.flatMap(package.colorToken(named:)) {
                let layers = token.nodeIDs.compactMap(package.node(withID:)).map(\.displayName)
                DetailsPane(text: (["\(token.name)", token.value, ""] + layers.map { "• \($0)" }).joined(separator: "\n")) {
                    RelationBar {
                        ColorSwatch(css: token.value)
                        Text(token.value).foregroundStyle(.secondary)
                        Spacer()
                        Text("Used by \(counted(token.nodeIDs.count, "layer"))")
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                placeholder("Select a token to see where it's used.")
            }
        }
    }

    @ViewBuilder
    private func layerRelations(_ node: SketchframeNode) -> some View {
        if let componentID = node.componentID, let component = package.component(withID: componentID) {
            RelationBar {
                Text("Instance of \(Text(component.name).bold())")
                Spacer()
                Button("Show Component") {
                    state.inspectorTab = .components
                    state.selectedComponentNodeID = component.root.id
                }
                .buttonStyle(.borderless)
            }
        }
        let notes = annotations.filter { package.node(for: $0)?.id == node.id }
        if let first = notes.first {
            RelationBar {
                Label(counted(notes.count, "annotation"), systemImage: "bubble.and.pencil")
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Show") {
                    state.selectedAnnotationID = first.id
                    state.sidebarMode = .annotations
                }
                .buttonStyle(.borderless)
            }
        }
    }

    @ViewBuilder
    private func componentRelations(_ node: SketchframeNode) -> some View {
        if let component = package.component(containing: node.id) {
            RelationBar {
                Text(componentCaption(component))
                    .foregroundStyle(.secondary)
                Spacer()
                if !component.instances.isEmpty {
                    Menu("Show Instance") {
                        ForEach(component.instances) { instance in
                            Button(instance.displayName) {
                                state.inspectorTab = .layers
                                state.selectedNodeID = instance.id
                            }
                        }
                    }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                }
            }
        }
    }

    private func placeholder(_ message: String) -> some View {
        Text(message)
            .font(.callout)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func componentCaption(_ component: SketchframeComponent) -> String {
        var parts = [counted(component.instances.count, "instance")]
        if let library = component.library { parts.append(library) }
        return parts.joined(separator: " · ")
    }
}

/// Monospaced, selectable JSON with optional relation bars above it and a
/// copy button in the corner.
private struct DetailsPane<Header: View>: View {
    let text: String
    @ViewBuilder let header: Header

    @State private var didCopy = false

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                Text(text)
                    .font(.system(size: 11, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
            }
            .overlay(alignment: .topTrailing) {
                Button(action: copy) {
                    Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: 16, height: 16)
                }
                .buttonStyle(.borderless)
                .padding(6)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 6))
                .padding(8)
                .help("Copy to Clipboard")
                .accessibilityLabel("Copy to Clipboard")
            }
        }
        .onChange(of: text) { didCopy = false }
    }

    private func copy() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        didCopy = true
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            didCopy = false
        }
    }
}

/// A one-line caption bar linking the selection to related items.
private struct RelationBar<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) { content }
                .font(.caption)
                .lineLimit(1)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            Divider()
        }
    }
}

/// A circle filled with a CSS color (`#rrggbb` or `rgba(…)`).
struct ColorSwatch: View {
    let css: String

    var body: some View {
        Circle()
            .fill(Color(css: css) ?? .clear)
            .overlay(Circle().strokeBorder(.separator))
            .frame(width: 16, height: 16)
    }
}

extension Color {
    /// Parses the CSS colors design.json uses: `#rrggbb` and `rgba(r, g, b, a)`.
    init?(css: String) {
        let value = css.trimmingCharacters(in: .whitespaces).lowercased()
        if value.hasPrefix("#"), value.count == 7, let rgb = Int(value.dropFirst(), radix: 16) {
            self.init(
                .sRGB,
                red: Double((rgb >> 16) & 0xff) / 255,
                green: Double((rgb >> 8) & 0xff) / 255,
                blue: Double(rgb & 0xff) / 255
            )
        } else if value.hasPrefix("rgba("), value.hasSuffix(")") {
            let parts = value.dropFirst(5).dropLast().split(separator: ",").compactMap {
                Double($0.trimmingCharacters(in: .whitespaces))
            }
            guard parts.count == 4 else { return nil }
            self.init(.sRGB, red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, opacity: parts[3])
        } else {
            return nil
        }
    }
}

private extension View {
    /// Outlines `target` on the canvas while the pointer is over this row.
    func hoverHighlight(_ target: HighlightTarget, in state: ViewerState) -> some View {
        onHover { isHovering in
            if isHovering {
                state.hovered = target
            } else if state.hovered == target {
                state.hovered = nil
            }
        }
    }
}
