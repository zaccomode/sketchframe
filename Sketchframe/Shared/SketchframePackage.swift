import Foundation
import CoreGraphics

/// A layer from `design.json`, positioned in the root frame's coordinate space.
nonisolated struct SketchframeNode: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let type: String
    /// For instances: the key of the symbol in `SketchframePackage.components`.
    let componentID: String?
    /// The node's unrotated size, in points.
    let size: CGSize
    /// Maps the node's local space (0,0 to width,height) into the root
    /// frame's space, including its own and its ancestors' position, rotation
    /// and flips.
    let transform: CGAffineTransform
    /// `nil` for leaves, so `List(children:)` doesn't show disclosure arrows.
    let children: [SketchframeNode]?
    /// The node's own JSON (without children), with shared style keys resolved.
    let details: String

    /// Top-left, top-right, bottom-right, bottom-left in root coordinates.
    var corners: [CGPoint] {
        [
            CGPoint(x: 0, y: 0),
            CGPoint(x: size.width, y: 0),
            CGPoint(x: size.width, y: size.height),
            CGPoint(x: 0, y: size.height),
        ].map { $0.applying(transform) }
    }

    func contains(_ point: CGPoint) -> Bool {
        let local = point.applying(transform.inverted())
        return CGRect(origin: .zero, size: size).contains(local)
    }

    static func == (lhs: SketchframeNode, rhs: SketchframeNode) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

/// A symbol used in the frame: its definition (master) and where it's used.
nonisolated struct SketchframeComponent: Identifiable, Hashable, Sendable {
    /// Sketch symbol ID.
    let id: String
    let name: String
    /// Name of the library the symbol comes from, if it isn't local.
    let library: String?
    /// The symbol master's layers, in the master's own coordinate space.
    let root: SketchframeNode
    /// Instance nodes in the frame that use this symbol.
    let instances: [SketchframeNode]

    static func == (lhs: SketchframeComponent, rhs: SketchframeComponent) -> Bool {
        lhs.id == rhs.id
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

nonisolated enum SketchframeError: LocalizedError {
    case missingDesign
    case invalidDesign

    var errorDescription: String? {
        switch self {
        case .missingDesign: "This Sketchframe has no design.json."
        case .invalidDesign: "This Sketchframe's design.json couldn't be read."
        }
    }
}

/// A `.sketchframe` package: `design.json`, a preview PNG and assets.
/// See docs/FORMAT.md.
nonisolated struct SketchframePackage: Sendable {
    static let designFileName = "design.json"
    static let defaultPreviewFileName = "preview@2x.png"

    /// Style fields that may hold a key into the top-level `styles` map.
    private static let styleFields = ["fills", "borders", "effects", "corners", "layout", "textStyle"]

    let name: String
    let root: SketchframeNode
    /// Symbols used in the frame, sorted by name.
    let components: [SketchframeComponent]
    let nodeCount: Int
    let styleCount: Int
    let tokenCount: Int
    let previewData: Data?
    /// Preview size in points (pixels ÷ scale). Can be larger than the root
    /// frame when shadows overflow its bounds.
    let previewSize: CGSize
    /// Where the root frame's top-left sits inside the preview, in points.
    let frameOrigin: CGPoint
    let designJSON: String

    init(contentsOf url: URL) throws {
        let designURL = url.appending(path: Self.designFileName)
        guard let designData = try? Data(contentsOf: designURL) else {
            throw SketchframeError.missingDesign
        }
        let previewURL = url.appending(path: Self.previewFileName(in: designData))
        try self.init(designData: designData, previewData: try? Data(contentsOf: previewURL))
    }

    init(fileWrapper: FileWrapper) throws {
        let files = fileWrapper.fileWrappers ?? [:]
        guard let designData = files[Self.designFileName]?.regularFileContents else {
            throw SketchframeError.missingDesign
        }
        let previewData = files[Self.previewFileName(in: designData)]?.regularFileContents
        try self.init(designData: designData, previewData: previewData)
    }

    private init(designData: Data, previewData: Data?) throws {
        guard
            let design = try? JSONSerialization.jsonObject(with: designData) as? [String: Any],
            design["format"] as? String == "sketchframe",
            let rootObject = design["root"] as? [String: Any]
        else {
            throw SketchframeError.invalidDesign
        }

        let styles = design["styles"] as? [String: Any] ?? [:]
        var nodeCount = 0
        let root = Self.node(from: rootObject, parentTransform: nil, styles: styles, count: &nodeCount)

        let preview = design["preview"] as? [String: Any] ?? [:]
        let scale = Self.number(preview["scale"]) ?? 2
        let pixelSize = Self.pngPixelSize(previewData)
            ?? CGSize(
                width: Self.number(preview["pixelWidth"]) ?? root.size.width * scale,
                height: Self.number(preview["pixelHeight"]) ?? root.size.height * scale
            )

        let tokens = design["tokens"] as? [String: Any] ?? [:]
        let colorTokens = tokens["colors"] as? [String: Any] ?? [:]

        // Component definitions live outside the frame, in their own
        // coordinate space; their layers don't count towards `nodeCount`.
        let instances = Self.instancesByComponent(in: root)
        var componentNodeCount = 0
        let components = (design["components"] as? [String: Any] ?? [:])
            .compactMap { key, value -> SketchframeComponent? in
                guard
                    let object = value as? [String: Any],
                    let rootObject = object["root"] as? [String: Any]
                else { return nil }
                return SketchframeComponent(
                    id: key,
                    name: object["name"] as? String ?? "",
                    library: object["library"] as? String,
                    root: Self.node(from: rootObject, parentTransform: nil, styles: styles, count: &componentNodeCount),
                    instances: instances[key] ?? []
                )
            }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }

        self.name = design["name"] as? String ?? root.name
        self.root = root
        self.components = components
        self.nodeCount = nodeCount
        self.styleCount = styles.count
        self.tokenCount = colorTokens.count
        let previewSize = CGSize(width: pixelSize.width / scale, height: pixelSize.height / scale)
        self.previewData = previewData
        self.previewSize = previewSize
        self.frameOrigin = Self.frameOrigin(
            preview: preview,
            root: rootObject,
            styles: styles,
            overflow: CGSize(
                width: previewSize.width - root.size.width,
                height: previewSize.height - root.size.height
            )
        )
        self.designJSON = String(decoding: designData, as: UTF8.self)
    }

    /// The deepest node under `point` (in root coordinates), preferring
    /// nodes painted on top.
    func hitTest(_ point: CGPoint) -> SketchframeNode? {
        // Children can sit outside an unclipped parent, so search them even
        // when the parent itself isn't hit.
        func search(_ node: SketchframeNode) -> SketchframeNode? {
            for child in (node.children ?? []).reversed() {
                if let hit = search(child) { return hit }
            }
            return node.contains(point) ? node : nil
        }
        return search(root)
    }

    /// Searches the frame, then each component's layers.
    func node(withID id: SketchframeNode.ID) -> SketchframeNode? {
        Self.find(id, in: root) ?? components.lazy.compactMap { Self.find(id, in: $0.root) }.first
    }

    /// The component whose definition contains `nodeID`, if any.
    func component(containing nodeID: SketchframeNode.ID) -> SketchframeComponent? {
        components.first { Self.find(nodeID, in: $0.root) != nil }
    }

    func component(withID id: SketchframeComponent.ID) -> SketchframeComponent? {
        components.first { $0.id == id }
    }

    private static func find(_ id: SketchframeNode.ID, in node: SketchframeNode) -> SketchframeNode? {
        if node.id == id { return node }
        for child in node.children ?? [] {
            if let found = find(id, in: child) { return found }
        }
        return nil
    }

    /// Every instance node in the frame, keyed by component ID, in paint order.
    private static func instancesByComponent(in root: SketchframeNode) -> [String: [SketchframeNode]] {
        var result: [String: [SketchframeNode]] = [:]
        func visit(_ node: SketchframeNode) {
            if let componentID = node.componentID { result[componentID, default: []].append(node) }
            node.children?.forEach(visit)
        }
        visit(root)
        return result
    }

    /// Reads `preview.src` from design.json without fully parsing the tree.
    static func previewFileName(in designData: Data) -> String {
        let design = try? JSONSerialization.jsonObject(with: designData) as? [String: Any]
        let preview = design?["preview"] as? [String: Any]
        return preview?["src"] as? String ?? defaultPreviewFileName
    }

    private static func node(
        from object: [String: Any],
        parentTransform: CGAffineTransform?,
        styles: [String: Any],
        count: inout Int
    ) -> SketchframeNode {
        count += 1
        let size = CGSize(width: number(object["width"]) ?? 0, height: number(object["height"]) ?? 0)

        // The root defines the coordinate space, so its own position and
        // rotation are ignored. Other nodes rotate and flip around the centre
        // of their unrotated frame.
        var transform = CGAffineTransform.identity
        if let parentTransform {
            let x = number(object["x"]) ?? 0
            let y = number(object["y"]) ?? 0
            let degrees = number(object["rotation"]) ?? 0
            transform = CGAffineTransform(translationX: -size.width / 2, y: -size.height / 2)
                .concatenating(CGAffineTransform(
                    scaleX: object["flipX"] as? Bool == true ? -1 : 1,
                    y: object["flipY"] as? Bool == true ? -1 : 1
                ))
                .concatenating(CGAffineTransform(rotationAngle: degrees * .pi / 180))
                .concatenating(CGAffineTransform(translationX: x + size.width / 2, y: y + size.height / 2))
                .concatenating(parentTransform)
        }

        var details = object
        details.removeValue(forKey: "children")
        for field in styleFields {
            if let key = details[field] as? String, let style = styles[key] {
                details[field] = style
            }
        }

        let children = (object["children"] as? [[String: Any]])?.map {
            node(from: $0, parentTransform: transform, styles: styles, count: &count)
        }

        return SketchframeNode(
            id: object["id"] as? String ?? UUID().uuidString,
            name: object["name"] as? String ?? "",
            type: object["type"] as? String ?? "group",
            componentID: object["componentId"] as? String,
            size: size,
            transform: transform,
            children: children?.isEmpty == false ? children : nil,
            details: prettyJSON(details)
        )
    }

    /// Uses `preview.origin` when the exporter recorded it. Older exports
    /// don't have it, so it's derived from the root's shadows and borders
    /// (which Sketch renders outside the frame), falling back to an even split
    /// when that doesn't account for all of the overflow.
    private static func frameOrigin(
        preview: [String: Any],
        root: [String: Any],
        styles: [String: Any],
        overflow: CGSize
    ) -> CGPoint {
        if let origin = preview["origin"] as? [String: Any],
           let x = number(origin["x"]), let y = number(origin["y"]) {
            return CGPoint(x: x, y: y)
        }

        func resolved(_ field: String) -> Any? {
            if let key = root[field] as? String { return styles[key] }
            return root[field]
        }

        var left = 0.0, top = 0.0, right = 0.0, bottom = 0.0
        func extend(_ l: Double, _ t: Double, _ r: Double, _ b: Double) {
            left = max(left, l); top = max(top, t); right = max(right, r); bottom = max(bottom, b)
        }

        let effects = resolved("effects") as? [String: Any]
        for shadow in effects?["shadows"] as? [[String: Any]] ?? [] where shadow["inset"] as? Bool != true {
            let x = number(shadow["x"]) ?? 0
            let y = number(shadow["y"]) ?? 0
            let reach = (number(shadow["blur"]) ?? 0) + (number(shadow["spread"]) ?? 0)
            extend(reach - x, reach - y, reach + x, reach + y)
        }
        for border in resolved("borders") as? [[String: Any]] ?? [] {
            let thickness = number(border["thickness"]) ?? 0
            switch border["position"] as? String {
            case "outside": extend(thickness, thickness, thickness, thickness)
            case "center": extend(thickness / 2, thickness / 2, thickness / 2, thickness / 2)
            default: break
            }
        }

        return CGPoint(
            x: abs(left + right - overflow.width) <= 1 ? left : overflow.width / 2,
            y: abs(top + bottom - overflow.height) <= 1 ? top : overflow.height / 2
        )
    }

    private static func number(_ value: Any?) -> Double? {
        (value as? NSNumber)?.doubleValue
    }

    /// Re-encodes through `JSONEncoder`, which prints the shortest form of
    /// each number (`0.6`, not `JSONSerialization`'s `0.59999999999999998`).
    private static func prettyJSON(_ object: Any) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(JSONValue(object)) else { return "" }
        return String(decoding: data, as: UTF8.self)
    }

    /// Width and height live at bytes 16..23 of the PNG IHDR chunk.
    private static func pngPixelSize(_ data: Data?) -> CGSize? {
        guard let data, data.count >= 24 else { return nil }
        let bytes = [UInt8](data.prefix(24))
        guard bytes[1] == 0x50, bytes[2] == 0x4E, bytes[3] == 0x47 else { return nil }
        func uint32(_ offset: Int) -> Int {
            bytes[offset..<offset + 4].reduce(0) { $0 << 8 | Int($1) }
        }
        return CGSize(width: uint32(16), height: uint32(20))
    }
}

/// Bridges `JSONSerialization` output to `Encodable`.
nonisolated private enum JSONValue: Encodable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(_ value: Any) {
        switch value {
        case let number as NSNumber where CFGetTypeID(number) == CFBooleanGetTypeID():
            self = .bool(number.boolValue)
        case let number as NSNumber:
            self = .number(number.doubleValue)
        case let string as String:
            self = .string(string)
        case let array as [Any]:
            self = .array(array.map(JSONValue.init))
        case let object as [String: Any]:
            self = .object(object.mapValues(JSONValue.init))
        default:
            self = .null
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}
