import SwiftUI

/// Disclosure rows for a node tree, with expansion held in `expanded` so
/// rows can be revealed programmatically (`List(children:)` can't do that).
/// Use inside a `List`; each row is tagged and identified by its node id.
struct NodeTree<Row: View>: View {
    let nodes: [SketchframeNode]
    @Binding var expanded: Set<SketchframeNode.ID>
    let row: (SketchframeNode) -> Row

    var body: some View {
        ForEach(nodes) { node in
            if let children = node.children {
                DisclosureGroup(isExpanded: isExpanded(node.id)) {
                    // Erased: a view that contains itself needs a concrete type.
                    AnyView(NodeTree(nodes: children, expanded: $expanded, row: row))
                } label: {
                    row(node)
                }
                .tag(node.id)
                .id(node.id)
            } else {
                row(node)
                    .tag(node.id)
                    .id(node.id)
            }
        }
    }

    private func isExpanded(_ id: SketchframeNode.ID) -> Binding<Bool> {
        Binding(
            get: { expanded.contains(id) },
            set: { isExpanded in
                if isExpanded { expanded.insert(id) } else { expanded.remove(id) }
            }
        )
    }
}

extension View {
    /// Expands the ancestors of `selection` whenever it changes, then scrolls
    /// its row into view.
    func revealing(
        _ selection: SketchframeNode.ID?,
        in package: SketchframePackage,
        expanded: Binding<Set<SketchframeNode.ID>>,
        proxy: ScrollViewProxy
    ) -> some View {
        onChange(of: selection, initial: true) { _, id in
            guard let id else { return }
            let ancestors = package.ancestorIDs(of: id)
            if !ancestors.allSatisfy(expanded.wrappedValue.contains) {
                expanded.wrappedValue.formUnion(ancestors)
            }
            // Give newly expanded rows a moment to exist before scrolling.
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(50))
                withAnimation(.easeInOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .center) }
            }
        }
    }
}
