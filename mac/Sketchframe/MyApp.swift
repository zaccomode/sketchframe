import AppKit
import SwiftUI

@main struct MyApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        DocumentGroup(viewing: SketchframeDocument.self) { file in
            SketchframeView(package: file.document.package, packageURL: file.fileURL)
                .frame(minWidth: 640, minHeight: 420)
        }
        .defaultSize(width: 1100, height: 650)
        .windowToolbarStyle(.unified(showsTitle: true))
        .commands { SketchframeCommands() }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Sketchframe is a viewer with nothing to do without a document, so it
    /// quits (and leaves the Dock) once its last window closes (#11). AppKit
    /// checks for remaining windows a moment after the close, so moving from
    /// the open panel to a document window doesn't quit it.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
