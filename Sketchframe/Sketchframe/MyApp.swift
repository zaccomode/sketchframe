import SwiftUI

@main struct MyApp: App {
    var body: some Scene {
        DocumentGroup(viewing: SketchframeDocument.self) { file in
            SketchframeView(package: file.document.package)
                .frame(minWidth: 800, minHeight: 520)
        }
        .defaultSize(width: 990, height: 610)
    }
}
