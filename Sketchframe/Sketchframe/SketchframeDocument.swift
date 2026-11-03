import SwiftUI
import UniformTypeIdentifiers

nonisolated extension UTType {
    /// Declared in the app's Info.plist; conforms to `com.apple.package`.
    static let sketchframe = UTType(exportedAs: "com.isaacshea.sketchframe")
}

/// Read-only document wrapper so the app can open `.sketchframe` packages.
nonisolated struct SketchframeDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.sketchframe]

    let package: SketchframePackage

    init(configuration: ReadConfiguration) throws {
        package = try SketchframePackage(fileWrapper: configuration.file)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        throw CocoaError(.fileWriteNoPermission)
    }
}
