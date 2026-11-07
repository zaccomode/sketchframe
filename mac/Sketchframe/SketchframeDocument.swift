import SwiftUI
import UniformTypeIdentifiers

nonisolated extension UTType {
    /// A `.sketchframe` archive (format v2): a single file. Declared in the
    /// app's Info.plist; conforms to `public.data`.
    static let sketchframe = UTType(exportedAs: "com.isaacshea.sketchframe")
    /// An older `.sketchframe` folder package (format v1), with the same
    /// extension. Declared in Info.plist as conforming to `com.apple.package`,
    /// so Launch Services picks it for directories and the archive type for
    /// files.
    static let sketchframePackage = UTType(exportedAs: "com.isaacshea.sketchframe.package")
}

/// Read-only document wrapper so the app can open `.sketchframe` archives and
/// older folder packages.
nonisolated struct SketchframeDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.sketchframe, .sketchframePackage]

    let package: SketchframePackage

    init(configuration: ReadConfiguration) throws {
        package = try SketchframePackage(fileWrapper: configuration.file)
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        throw CocoaError(.fileWriteNoPermission)
    }
}
