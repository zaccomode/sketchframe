import SwiftUI

@main struct MyApp: App {
    var body: some Scene {
        DocumentGroup(viewing: SketchframeDocument.self) { file in
            SketchframeView(package: file.document.package, presentation: .window(packageURL: file.fileURL))
                .frame(minWidth: 640, minHeight: 420)
        }
        .defaultSize(width: 1100, height: 650)
        .windowToolbarStyle(.unified(showsTitle: true))
        .commands { SketchframeCommands() }
    }
}
