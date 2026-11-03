import SwiftUI

/// View and Annotations menu items, acting on the focused window's viewer.
struct SketchframeCommands: Commands {
    @FocusedValue(\.viewerState) private var state

    var body: some Commands {
        CommandGroup(before: .toolbar) {
            Button("Zoom In") { state?.zoomIn() }
                .keyboardShortcut("=")
            Button("Zoom Out") { state?.zoomOut() }
                .keyboardShortcut("-")
            Button("Actual Size") { state?.zoomToActualSize() }
                .keyboardShortcut("0")
            Button("Zoom to Fit") { state?.zoomToFit() }
                .keyboardShortcut("9")
            Divider()
            Button(state?.isShowing(.inspector) == true ? "Hide Inspector" : "Show Inspector") {
                state?.toggle(.inspector)
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
            Button(state?.isShowing(.annotations) == true ? "Hide Annotations" : "Show Annotations") {
                state?.toggle(.annotations)
            }
            .keyboardShortcut("a", modifiers: [.command, .option])
            Divider()
        }

        CommandMenu("Annotations") {
            Button("Add Annotation") {
                if let state, let nodeID = state.selectedNodeID { state.beginAnnotation(on: nodeID) }
            }
            .keyboardShortcut("n", modifiers: [.command, .option])
            .disabled(state?.selectedNodeID == nil || state?.canEditAnnotations != true)
        }
    }
}
