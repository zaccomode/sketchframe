import Foundation

/// Like Figma's annotation categories.
nonisolated enum AnnotationCategory: String, Codable, CaseIterable, Identifiable, Sendable {
    case development
    case interaction
    case accessibility
    case content

    var id: String { rawValue }

    var title: String { rawValue.capitalized }

    var symbolName: String {
        switch self {
        case .development: "chevron.left.forwardslash.chevron.right"
        case .interaction: "hand.tap"
        case .accessibility: "accessibility"
        case .content: "text.alignleft"
        }
    }

    /// Unknown categories (e.g. from a newer version) read as `.content`
    /// rather than failing the whole file.
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AnnotationCategory(rawValue: raw) ?? .content
    }
}

/// A note left on a layer. Stored in the Sketchframe's `annotations.json`.
nonisolated struct SketchframeAnnotation: Codable, Identifiable, Hashable, Sendable {
    var id: String
    /// The node's `id` in design.json when the note was written. Ids are
    /// renumbered on re-export, so `sketchId` and `layerPath` are tried first.
    var nodeId: String
    var sketchId: String?
    /// Layer names from the root's children down to the annotated layer.
    var layerPath: [String]
    var layerName: String
    var category: AnnotationCategory
    var text: String
    var createdAt: Date
    var updatedAt: Date?

    init(node: SketchframeNode, category: AnnotationCategory, text: String) {
        self.id = UUID().uuidString
        self.nodeId = node.id
        self.sketchId = node.sketchID
        self.layerPath = node.path
        self.layerName = node.name
        self.category = category
        self.text = text
        self.createdAt = .now
    }
}

/// Reads and writes `annotations.json`:
/// `{ "version": 1, "annotations": [ … ] }`.
nonisolated enum SketchframeAnnotationsFile {
    static let fileName = "annotations.json"

    private struct Contents: Codable {
        var version = 1
        var annotations: [SketchframeAnnotation]
    }

    static func decode(_ data: Data?) -> [SketchframeAnnotation] {
        guard let data else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try? decoder.decode(Contents.self, from: data))?.annotations ?? []
    }

    static func encode(_ annotations: [SketchframeAnnotation]) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(Contents(annotations: annotations))
    }

    /// Saves annotations into a Sketchframe, or removes the file when there
    /// are none left. An archive is rewritten with the new annotations.json
    /// beside its other files, then atomically replaces the original; a folder
    /// package gets the file written inside it.
    static func save(_ annotations: [SketchframeAnnotation], toPackageAt packageURL: URL) throws {
        let contents = annotations.isEmpty ? nil : try encode(annotations)
        if !SketchframeArchive.isDirectory(packageURL) {
            var files = try SketchframeArchive.entries(in: try Data(contentsOf: packageURL))
            files[fileName] = contents
            try SketchframeArchive.archive(files).write(to: packageURL, options: .atomic)
            return
        }
        let fileURL = packageURL.appending(path: fileName)
        guard let contents else {
            if FileManager.default.fileExists(atPath: fileURL.path(percentEncoded: false)) {
                try FileManager.default.removeItem(at: fileURL)
            }
            return
        }
        try contents.write(to: fileURL, options: .atomic)
    }
}
