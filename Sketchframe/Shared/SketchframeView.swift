import SwiftUI
import AppKit

/// A Sketchframe package: the zoomable preview, and a sidebar showing either
/// the inspector or annotations.
///
/// In a window, the sidebar is a native inspector column toggled from the
/// toolbar, and annotations are saved into the package as they change. In
/// Quick Look there's no toolbar, so the sidebar is always shown and
/// annotations are read-only.
struct SketchframeView: View {
    enum Presentation {
        /// `packageURL` is where annotations are saved; `nil` makes them read-only.
        case window(packageURL: URL?)
        case quickLook
    }

    let package: SketchframePackage
    let presentation: Presentation
    private let previewImage: NSImage?

    @State private var state: ViewerState
    @State private var annotations: [SketchframeAnnotation]
    @State private var saveError: String?

    init(package: SketchframePackage, presentation: Presentation) {
        self.package = package
        self.presentation = presentation
        self.previewImage = package.previewData.flatMap(NSImage.init(data:))

        let canEdit = if case .window(let url) = presentation { url != nil } else { false }
        _state = State(initialValue: ViewerState(canEditAnnotations: canEdit, expandedNodeIDs: [package.root.id]))
        _annotations = State(initialValue: package.annotations)
    }

    var body: some View {
        switch presentation {
        case .window(let packageURL):
            windowLayout(packageURL: packageURL)
        case .quickLook:
            quickLookLayout
        }
    }

    // MARK: Layouts

    private func windowLayout(packageURL: URL?) -> some View {
        @Bindable var state = state
        return canvas(showsBadges: state.isShowing(.annotations))
            .inspector(isPresented: $state.isSidebarShown) {
                sidebar
                    .inspectorColumnWidth(min: 260, ideal: 300, max: 440)
            }
            .toolbar { toolbar }
            .navigationSubtitle(summary)
            .focusedSceneValue(\.viewerState, state)
            .onChange(of: annotations) { _, newValue in
                guard let packageURL else { return }
                do {
                    try SketchframeAnnotationsFile.save(newValue, toPackageAt: packageURL)
                } catch {
                    saveError = error.localizedDescription
                }
            }
            .alert(
                "Couldn't Save Annotations",
                isPresented: Binding(get: { saveError != nil }, set: { if !$0 { saveError = nil } }),
                presenting: saveError
            ) { _ in
                Button("OK") { saveError = nil }
            } message: { message in
                Text(message)
            }
    }

    private var quickLookLayout: some View {
        @Bindable var state = state
        return HStack(spacing: 0) {
            canvas(showsBadges: true)
            Divider()
            VStack(spacing: 0) {
                if !annotations.isEmpty {
                    Picker("Sidebar", selection: $state.sidebarMode) {
                        Text("Inspector").tag(SidebarMode.inspector)
                        Text("Annotations").tag(SidebarMode.annotations)
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .padding(.horizontal, 10)
                    .padding(.top, 8)
                }
                sidebar
            }
            .frame(width: 300)
        }
    }

    private func canvas(showsBadges: Bool) -> some View {
        CanvasView(
            package: package,
            previewImage: previewImage,
            annotations: annotations,
            showsAnnotationBadges: showsBadges && !annotations.isEmpty,
            state: state
        )
        .frame(minWidth: 320, maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var sidebar: some View {
        switch state.sidebarMode {
        case .inspector:
            InspectorView(package: package, annotations: annotations, state: state)
        case .annotations:
            AnnotationsView(package: package, state: state, annotations: $annotations)
        }
    }

    // MARK: Toolbar

    /// Two groups, each drawn as one capsule: zoom, and the sidebar toggles.
    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItemGroup(placement: .primaryAction) {
            Button { state.zoomOut() } label: {
                Label("Zoom Out", systemImage: "minus.magnifyingglass")
            }
            .help("Zoom Out")
            Button { state.zoomToActualSize() } label: {
                Label("Actual Size", systemImage: "1.magnifyingglass")
            }
            .help("Actual Size")
            Button { state.zoomIn() } label: {
                Label("Zoom In", systemImage: "plus.magnifyingglass")
            }
            .help("Zoom In")
        }

        if #available(macOS 26, *) {
            ToolbarSpacer(.fixed, placement: .primaryAction)
        }

        ToolbarItemGroup(placement: .primaryAction) {
            Toggle(isOn: sidebarToggle(.annotations)) {
                Label("Annotations", systemImage: "bubble.and.pencil")
            }
            .help("Show Annotations")
            Toggle(isOn: sidebarToggle(.inspector)) {
                Label("Inspector", systemImage: "info")
            }
            .help("Show Inspector")
        }
    }

    private func sidebarToggle(_ mode: SidebarMode) -> Binding<Bool> {
        Binding(get: { state.isShowing(mode) }, set: { _ in state.toggle(mode) })
    }

    private var summary: String {
        var parts = [
            "\(format(package.root.size.width))×\(format(package.root.size.height))",
            counted(package.nodeCount, "layer"),
        ]
        if !annotations.isEmpty { parts.append(counted(annotations.count, "annotation")) }
        return parts.joined(separator: " · ")
    }
}

/// "1 layer", "9 layers".
func counted(_ count: Int, _ noun: String) -> String {
    "\(count) \(noun)\(count == 1 ? "" : "s")"
}

/// Whole numbers without decimals, others to one decimal place.
func format(_ value: CGFloat) -> String {
    value.rounded() == value ? String(Int(value)) : String(format: "%.1f", value)
}
