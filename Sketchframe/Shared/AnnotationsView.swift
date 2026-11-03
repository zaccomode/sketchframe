import SwiftUI

/// Annotation cards, numbered to match the badges on the canvas, plus the
/// editor for writing a new one.
struct AnnotationsView: View {
    let package: SketchframePackage
    @Bindable var state: ViewerState
    @Binding var annotations: [SketchframeAnnotation]

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(spacing: 8) {
                    if state.draft?.annotationID == nil {
                        editor
                    }
                    ForEach(Array(annotations.enumerated()), id: \.element.id) { index, annotation in
                        if state.draft?.annotationID == annotation.id {
                            editor
                        } else {
                            card(annotation, number: index + 1)
                        }
                    }
                }
                .padding(8)
            }
            .overlay {
                if annotations.isEmpty && state.draft == nil {
                    ContentUnavailableView {
                        Label("No Annotations", systemImage: "bubble.and.pencil")
                    } description: {
                        Text(
                            state.canEditAnnotations
                                ? "Select a layer, then choose Add Annotation."
                                : "Open this file in Sketchframe to add annotations."
                        )
                    }
                }
            }

            if state.canEditAnnotations {
                Divider()
                addBar
            }
        }
    }

    // MARK: Cards

    private func card(_ annotation: SketchframeAnnotation, number: Int) -> some View {
        let node = package.node(for: annotation)
        let isSelected = state.selectedAnnotationID == annotation.id

        return VStack(alignment: .leading, spacing: 8) {
            Text(annotation.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 6) {
                AnnotationBadge(number: number, category: annotation.category)
                if let node {
                    Image(systemName: node.symbolName)
                        .foregroundStyle(.tint)
                    Text(node.displayName)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                } else {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                    Text("\(annotation.layerName) (layer not found)")
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                CategoryLabel(category: annotation.category)
            }
            .font(.caption)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(.quaternary.opacity(0.6)))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(isSelected ? Color.accentColor : .clear, lineWidth: 1.5)
        )
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onTapGesture(count: 2) {
            if let node { state.beginEditing(annotation, nodeID: node.id) }
        }
        .onTapGesture {
            state.selectedAnnotationID = annotation.id
            state.selectedNodeID = node?.id
        }
        .onHover { isHovering in
            if isHovering {
                state.hovered = .annotation(annotation.id)
            } else if state.hovered == .annotation(annotation.id) {
                state.hovered = nil
            }
        }
        .contextMenu {
            if state.canEditAnnotations, let node {
                Button("Edit") { state.beginEditing(annotation, nodeID: node.id) }
            }
            if let node {
                Button("Show in Layers") {
                    state.showInLayers(node.id)
                }
            }
            if state.canEditAnnotations {
                Divider()
                Button("Delete", role: .destructive) { delete(annotation) }
            }
        }
    }

    // MARK: Editing

    /// Bound through a fallback copy rather than `Binding($state.draft)`:
    /// that binding force-unwraps, and the text field can read it once more
    /// after Save or Cancel clears the draft, which crashes.
    @ViewBuilder
    private var editor: some View {
        if let current = state.draft {
            AnnotationEditor(
                draft: Binding(
                    get: { state.draft ?? current },
                    set: { if state.draft != nil { state.draft = $0 } }
                ),
                node: package.node(withID: current.nodeID),
                onCancel: { state.draft = nil },
                onSave: save
            )
        }
    }

    private var addBar: some View {
        let node = state.selectedNodeID.flatMap(package.node(withID:))
        return HStack(spacing: 8) {
            Button {
                if let node { state.beginAnnotation(on: node.id) }
            } label: {
                Label("Add Annotation", systemImage: "plus")
            }
            .disabled(node == nil || state.draft != nil)

            Spacer()

            Text(node.map { "to \($0.displayName)" } ?? "Select a layer")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(8)
    }

    private func save(_ draft: AnnotationDraft) {
        let text = draft.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        if let id = draft.annotationID, let index = annotations.firstIndex(where: { $0.id == id }) {
            annotations[index].text = text
            annotations[index].category = draft.category
            annotations[index].updatedAt = .now
        } else if let node = package.node(withID: draft.nodeID) {
            let annotation = SketchframeAnnotation(node: node, category: draft.category, text: text)
            annotations.append(annotation)
            state.selectedAnnotationID = annotation.id
        }
        state.draft = nil
    }

    private func delete(_ annotation: SketchframeAnnotation) {
        annotations.removeAll { $0.id == annotation.id }
        if state.selectedAnnotationID == annotation.id { state.selectedAnnotationID = nil }
        if state.hovered == .annotation(annotation.id) { state.hovered = nil }
    }
}

private struct AnnotationEditor: View {
    @Binding var draft: AnnotationDraft
    let node: SketchframeNode?
    let onCancel: () -> Void
    let onSave: (AnnotationDraft) -> Void

    @FocusState private var isTextFocused: Bool

    private var canSave: Bool {
        !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Add a note…", text: $draft.text, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(3...12)
                .focused($isTextFocused)

            HStack(spacing: 6) {
                if let node {
                    Image(systemName: node.symbolName)
                        .foregroundStyle(.tint)
                    Text(node.displayName)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                Picker("Category", selection: $draft.category) {
                    ForEach(AnnotationCategory.allCases) { category in
                        Label(category.title, systemImage: category.symbolName).tag(category)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .fixedSize()
            }
            .font(.caption)

            HStack {
                Spacer()
                Button("Cancel", action: onCancel)
                    .keyboardShortcut(.cancelAction)
                Button("Save") { onSave(draft) }
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canSave)
            }
            .controlSize(.small)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(.quaternary.opacity(0.6)))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.accentColor, lineWidth: 1.5))
        .onAppear { isTextFocused = true }
    }
}

private struct CategoryLabel: View {
    let category: AnnotationCategory

    var body: some View {
        Label(category.title, systemImage: category.symbolName)
            .labelStyle(.titleAndIcon)
            .font(.caption2.weight(.medium))
            .foregroundStyle(category.color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(category.color.opacity(0.15)))
    }
}
