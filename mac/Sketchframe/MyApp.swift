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
        .commands {
            CommandGroup(after: .appInfo) {
                CheckForUpdatesButton(updater: .shared)
            }
            SketchframeCommands()
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Starts the updater at launch rather than whenever the menu is first
    /// built, so its scheduled checks don't depend on SwiftUI's timing.
    func applicationDidFinishLaunching(_ notification: Notification) {
        _ = AppUpdater.shared
    }

    /// Sketchframe is a viewer with nothing to do without a document, so it
    /// quits (and leaves the Dock) once its last window closes (#11). AppKit
    /// checks for remaining windows a moment after the close, so moving from
    /// the open panel to a document window doesn't quit it.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
