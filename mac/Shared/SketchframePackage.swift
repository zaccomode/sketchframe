import Foundation
import CoreGraphics

/// A layer from `design.json`, positioned in the root frame's coordinate space.
nonisolated struct SketchframeNode: Identifiable, Hashable, Sendable {
    let id: String
    /// Stable hash of the Sketch layer ID; survives re-exports.
    let sketchID: String?
    let name: String
    let type: String
    /// Layer names from the root's children down to this node (empty for the root).
    let path: [String]
    /// For instances: the key of the symbol in `SketchframePackage.components`.
    let componentID: String?
    /// Name of the Sketch shared layer or text style applied to this node.
    let sharedStyle: String?
    /// Keys into design.json's `styles` map that this node references.
    let styleKeys: [String]
    /// Color token names referenced anywhere in this node's style.
    let tokens: Set<String>
    /// The node's unrotated size, in points.
    let size: CGSize
    /// Maps the node's local space (0,0 to width,height) into the root
    /// frame's space, including its own and its ancestors' position, rotation
    /// and flips.
    let transform: CGAffineTransform
    /// The shape the canvas outlines: the node's corners, or an ellipse for ovals.
    let shape: OutlineShape
    /// `nil` for leaves, so `List(children:)` doesn't show disclosure arrows.
    let children: [SketchframeNode]?
    /// The node's own JSON (without children), with shared style keys resolved.
    let details: String
    /// Just the node's style fields as JSON, for describing its shared style.
    let styleDetails: String
    /// The node's properties, grouped for the inspector's Properties view.
    let sections: [PropertySection]
    /// Just the node's style fields, grouped for the inspector's Properties view.
    let styleSections: [PropertySection]

    /// Top-left, top-right, bottom-right, bottom-left in root coordinates.
    var corners: [CGPoint] {
        [
            CGPoint(x: 0, y: 0),
            CGPoint(x: size.width, y: 0),
            CGPoint(x: size.width, y: size.height),
            CGPoint(x: 0, y: size.height),
        ].map { $0.applying(transform) }
    }

    var displayName: String { name.isEmpty ? type : name }

    var symbolName: String {
        switch type {
        case "frame": "square.dashed"
        case "graphic": "square.on.circle"
        case "group": "folder"
        case "instance": "diamond"
        case "text": "textformat"
        case "image": "photo"
        case "rectangle": "rectangle"
        case "oval": "circle"
        case "vector": "scribble"
        default: "square"
        }
    }

    func contains(_ point: CGPoint) -> Bool {
        let local = point.applying(transform.inverted())
        return CGRect(origin: .zero, size: size).contains(local)
    }

    /// This node and all of its descendants, depth first.
    var allNodes: [SketchframeNode] {
        [self] + (children ?? []).flatMap(\.allNodes)
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

/// A Sketch shared style, or a style value the exporter deduplicated into
/// design.json's `styles` map.
nonisolated struct SketchframeStyle: Identifiable, Hashable, Sendable {
    enum Kind: Hashable, Sendable {
        /// A named Sketch shared layer or text style.
        case shared
        /// A value reused by several layers (a key in `styles`).
        case reused
    }

    let id: String
    let name: String
    let kind: Kind
    /// For reused values: `fill`, `border`, `effect`, `corner`, `layout` or `text`.
    let category: String?
    let details: String
    /// The style's values, grouped for the inspector's Properties view.
    let sections: [PropertySection]
    let nodeIDs: [SketchframeNode.ID]

    var symbolName: String {
        switch category {
        case "fill": "paintbrush"
        case "border": "square.dashed"
        case "effect": "shadow"
        case "corner": "square.on.square"
        case "layout": "rectangle.split.3x1"
        case "text": "textformat"
        default: "paintbrush.pointed"
        }
    }
}

/// A color variable (Sketch swatch) used in the frame.
nonisolated struct SketchframeColorToken: Identifiable, Hashable, Sendable {
    var id: String { name }
    let name: String
    /// CSS color, e.g. `#3b5bdb` or `rgba(0, 0, 0, 0.5)`.
    let value: String
    let nodeIDs: [SketchframeNode.ID]
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

/// A `.sketchframe`: `design.json`, a preview PNG, assets and (optionally)
/// `annotations.json`, in a single-file archive (format v2) or an older folder
/// package (format v1). See docs/FORMAT.md.
nonisolated struct SketchframePackage: Sendable {
    static let designFileName = "design.json"
    static let defaultPreviewFileName = "preview@2x.png"

    /// Style fields that may hold a key into the top-level `styles` map.
    private static let styleFields = ["fills", "borders", "effects", "corners", "layout", "textStyle"]
    /// Fields that describe a node's appearance (shown for shared styles).
    private static let appearanceFields = [
        "fills", "borders", "borderOptions", "effects", "corners", "textStyle", "opacity", "blendMode",
    ]

    let name: String
    let root: SketchframeNode
    /// Symbols used in the frame, sorted by name.
    let components: [SketchframeComponent]
    /// Sketch shared styles first, then reused values.
    let styles: [SketchframeStyle]
    let colorTokens: [SketchframeColorToken]
    /// As saved in `annotations.json` when the package was opened.
    let annotations: [SketchframeAnnotation]
    let nodeCount: Int
    let previewData: Data?
    /// Preview size in points (pixels ÷ scale). Can be larger than the root
    /// frame when shadows overflow its bounds.
    let previewSize: CGSize
    /// Where the root frame's top-left sits inside the preview, in points.
    let frameOrigin: CGPoint
    let designJSON: String

    /// Reads a Sketchframe on disk: a single-file archive or a folder package.
    init(contentsOf url: URL) throws {
        if !SketchframeArchive.isDirectory(url) {
            try self.init(archiveData: try Data(contentsOf: url))
            return
        }
        let designURL = url.appending(path: Self.designFileName)
        guard let designData = try? Data(contentsOf: designURL) else {
            throw SketchframeError.missingDesign
        }
        let previewURL = url.appending(path: Self.previewFileName(in: designData))
        let annotationsURL = url.appending(path: SketchframeAnnotationsFile.fileName)
        try self.init(
            designData: designData,
            previewData: try? Data(contentsOf: previewURL),
            annotationsData: try? Data(contentsOf: annotationsURL)
        )
    }

    /// A regular file is an archive (format v2); a directory is a folder
    /// package (format v1), still read so older exports keep working.
    init(fileWrapper: FileWrapper) throws {
        if fileWrapper.isRegularFile {
            guard let data = fileWrapper.regularFileContents else { throw SketchframeError.missingDesign }
            try self.init(archiveData: data)
            return
        }
        let files = fileWrapper.fileWrappers ?? [:]
        guard let designData = files[Self.designFileName]?.regularFileContents else {
            throw SketchframeError.missingDesign
        }
        try self.init(
            designData: designData,
            previewData: files[Self.previewFileName(in: designData)]?.regularFileContents,
            annotationsData: files[SketchframeAnnotationsFile.fileName]?.regularFileContents
        )
    }

    init(archiveData: Data) throws {
        let files = try SketchframeArchive.entries(in: archiveData)
        guard let designData = files[Self.designFileName] else {
            throw SketchframeError.missingDesign
        }
        try self.init(
            designData: designData,
            previewData: files[Self.previewFileName(in: designData)],
            annotationsData: files[SketchframeAnnotationsFile.fileName]
        )
    }

    /// The preview image of a Sketchframe on disk, in either form, for Quick
    /// Look. Reads the archive once rather than once per file.
    static func previewImageData(at url: URL) -> Data? {
        if SketchframeArchive.isDirectory(url) {
            let designData = try? Data(contentsOf: url.appending(path: designFileName))
            let name = designData.map(previewFileName(in:)) ?? defaultPreviewFileName
            return try? Data(contentsOf: url.appending(path: name))
        }
        guard
            let data = try? Data(contentsOf: url),
            let files = try? SketchframeArchive.entries(in: data)
        else { return nil }
        let name = files[designFileName].map(previewFileName(in:)) ?? defaultPreviewFileName
        return files[name]
    }

    private init(designData: Data, previewData: Data?, annotationsData: Data?) throws {
        guard
            let design = try? JSONSerialization.jsonObject(with: designData) as? [String: Any],
            design["format"] as? String == "sketchframe",
            let rootObject = design["root"] as? [String: Any]
        else {
            throw SketchframeError.invalidDesign
        }

        let styleValues = design["styles"] as? [String: Any] ?? [:]
        var nodeCount = 0
        let root = Self.node(from: rootObject, parentTransform: nil, path: nil, styles: styleValues, count: &nodeCount)
        let frameNodes = root.allNodes

        let preview = design["preview"] as? [String: Any] ?? [:]
        let scale = Self.number(preview["scale"]) ?? 2
        let pixelSize = Self.pngPixelSize(previewData)
            ?? CGSize(
                width: Self.number(preview["pixelWidth"]) ?? root.size.width * scale,
                height: Self.number(preview["pixelHeight"]) ?? root.size.height * scale
            )

        // Component definitions live outside the frame, in their own
        // coordinate space; their layers don't count towards `nodeCount`.
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
                    root: Self.node(
                        from: rootObject, parentTransform: nil, path: nil, styles: styleValues, count: &componentNodeCount
                    ),
                    instances: frameNodes.filter { $0.componentID == key }
                )
            }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }

        let tokens = design["tokens"] as? [String: Any] ?? [:]
        let colorTokens = (tokens["colors"] as? [String: Any] ?? [:])
            .map { name, value in
                SketchframeColorToken(
                    name: name,
                    value: value as? String ?? "",
                    nodeIDs: frameNodes.filter { $0.tokens.contains(name) }.map(\.id)
                )
            }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }

        self.name = design["name"] as? String ?? root.name
        self.root = root
        self.components = components
        self.styles = Self.sharedStyles(in: frameNodes) + Self.reusedStyles(styleValues, in: frameNodes)
        self.colorTokens = colorTokens
        self.annotations = SketchframeAnnotationsFile.decode(annotationsData)
        self.nodeCount = nodeCount
        let previewSize = CGSize(width: pixelSize.width / scale, height: pixelSize.height / scale)
        self.previewData = previewData
        self.previewSize = previewSize
        self.frameOrigin = Self.frameOrigin(
            preview: preview,
            root: rootObject,
            styles: styleValues,
            overflow: CGSize(
                width: previewSize.width - root.size.width,
                height: previewSize.height - root.size.height
            )
        )
        self.designJSON = String(decoding: designData, as: UTF8.self)
    }

    // MARK: Lookup

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

    /// Ids of the nodes above `id` (root first) in the frame or in the
    /// component definition that contains it. Empty if `id` isn't found.
    func ancestorIDs(of id: SketchframeNode.ID) -> [SketchframeNode.ID] {
        func search(_ node: SketchframeNode, trail: [SketchframeNode.ID]) -> [SketchframeNode.ID]? {
            if node.id == id { return trail }
            for child in node.children ?? [] {
                if let found = search(child, trail: trail + [node.id]) { return found }
            }
            return nil
        }
        for root in [root] + components.map(\.root) {
            if let trail = search(root, trail: []) { return trail }
        }
        return []
    }

    /// The component whose definition contains `nodeID`, if any.
    func component(containing nodeID: SketchframeNode.ID) -> SketchframeComponent? {
        components.first { Self.find(nodeID, in: $0.root) != nil }
    }

    func component(withID id: SketchframeComponent.ID) -> SketchframeComponent? {
        components.first { $0.id == id }
    }

    func style(withID id: SketchframeStyle.ID) -> SketchframeStyle? {
        styles.first { $0.id == id }
    }

    func colorToken(named name: String) -> SketchframeColorToken? {
        colorTokens.first { $0.name == name }
    }

    /// The frame layer an annotation belongs to: by Sketch ID, then by layer
    /// path, then by the node id it was written against (if the name still
    /// matches). `nil` if the layer is gone.
    func node(for annotation: SketchframeAnnotation) -> SketchframeNode? {
        let nodes = root.allNodes
        if let sketchID = annotation.sketchId, let node = nodes.first(where: { $0.sketchID == sketchID }) {
            return node
        }
        if !annotation.layerPath.isEmpty, let node = nodes.first(where: { $0.path == annotation.layerPath }) {
            return node
        }
        if let node = Self.find(annotation.nodeId, in: root), node.name == annotation.layerName {
            return node
        }
        return nil
    }

    private static func find(_ id: SketchframeNode.ID, in node: SketchframeNode) -> SketchframeNode? {
        if node.id == id { return node }
        for child in node.children ?? [] {
            if let found = find(id, in: child) { return found }
        }
        return nil
    }

    /// Reads `preview.src` from design.json without fully parsing the tree.
    static func previewFileName(in designData: Data) -> String {
        let design = try? JSONSerialization.jsonObject(with: designData) as? [String: Any]
        let preview = design?["preview"] as? [String: Any]
        return preview?["src"] as? String ?? defaultPreviewFileName
    }

    // MARK: Parsing

    private static func node(
        from object: [String: Any],
        parentTransform: CGAffineTransform?,
        path parentPath: [String]?,
        styles: [String: Any],
        count: inout Int
    ) -> SketchframeNode {
        count += 1
        let size = CGSize(width: number(object["width"]) ?? 0, height: number(object["height"]) ?? 0)
        let name = object["name"] as? String ?? ""
        let path = parentPath.map { $0 + [name] } ?? []

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
        var styleKeys: [String] = []
        for field in styleFields {
            if let key = details[field] as? String, let style = styles[key] {
                styleKeys.append(key)
                details[field] = style
            }
        }
        let appearance = details.filter { appearanceFields.contains($0.key) }

        let children = (object["children"] as? [[String: Any]])?.map {
            node(from: $0, parentTransform: transform, path: path, styles: styles, count: &count)
        }

        let type = object["type"] as? String ?? "group"
        return SketchframeNode(
            id: object["id"] as? String ?? UUID().uuidString,
            sketchID: object["sketchId"] as? String,
            name: name,
            type: type,
            path: path,
            componentID: object["componentId"] as? String,
            sharedStyle: object["sharedStyle"] as? String,
            styleKeys: styleKeys,
            tokens: tokenNames(in: details),
            size: size,
            transform: transform,
            shape: OutlineShape(type: type, corners: details["corners"]),
            children: children?.isEmpty == false ? children : nil,
            details: prettyJSON(details),
            styleDetails: prettyJSON(appearance),
            sections: PropertySections.node(details),
            styleSections: PropertySections.node(appearance)
        )
    }

    /// Values of every `token` / `colorToken` key, at any depth.
    private static func tokenNames(in value: Any) -> Set<String> {
        switch value {
        case let object as [String: Any]:
            var names = Set<String>()
            for (key, child) in object {
                if key == "token" || key == "colorToken", let name = child as? String {
                    names.insert(name)
                } else {
                    names.formUnion(tokenNames(in: child))
                }
            }
            return names
        case let array as [Any]:
            return array.reduce(into: Set<String>()) { $0.formUnion(tokenNames(in: $1)) }
        default:
            return []
        }
    }

    /// Named Sketch shared styles, described by the first layer that uses each.
    private static func sharedStyles(in nodes: [SketchframeNode]) -> [SketchframeStyle] {
        var order: [String] = []
        var users: [String: [SketchframeNode]] = [:]
        for node in nodes {
            guard let name = node.sharedStyle else { continue }
            if users[name] == nil { order.append(name) }
            users[name, default: []].append(node)
        }
        return order
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
            .map { name in
                let nodes = users[name] ?? []
                return SketchframeStyle(
                    id: "shared:\(name)",
                    name: name,
                    kind: .shared,
                    category: nodes.first?.type == "text" ? "text" : nil,
                    details: nodes.first?.styleDetails ?? "",
                    sections: nodes.first?.styleSections ?? [],
                    nodeIDs: nodes.map(\.id)
                )
            }
    }

    /// Values in design.json's `styles` map, grouped by kind.
    private static func reusedStyles(_ styles: [String: Any], in nodes: [SketchframeNode]) -> [SketchframeStyle] {
        let order = ["fill", "border", "effect", "corner", "layout", "text"]
        return styles
            .map { key, value in
                let category = key.split(separator: "_").first.map(String.init)
                return SketchframeStyle(
                    id: "style:\(key)",
                    name: key,
                    kind: .reused,
                    category: category,
                    details: prettyJSON(value),
                    sections: PropertySections.style(category: category, value: value),
                    nodeIDs: nodes.filter { $0.styleKeys.contains(key) }.map(\.id)
                )
            }
            .sorted {
                let lhs = order.firstIndex(of: $0.category ?? "") ?? order.count
                let rhs = order.firstIndex(of: $1.category ?? "") ?? order.count
                return lhs == rhs ? $0.name < $1.name : lhs < rhs
            }
    }

    /// Measures where the frame sits the way the exporter does: every
    /// node's frame, grown by its outer shadows and outside/centre borders
    /// (Sketch renders those of descendants too, even inside a clipping
    /// frame), rounded outwards to whole points. On an axis where that
    /// matches the preview, the measurement wins, since exporters before 0.6.1
    /// only measured the root and recorded a wrong `preview.origin` when a
    /// child's shadow spilled out. Otherwise `preview.origin` is used when
    /// recorded, else the overflow is assumed to be split evenly. Mirrors
    /// `frameOrigin` in packages/core/src/preview.ts.
    private static func frameOrigin(
        preview: [String: Any],
        root: [String: Any],
        styles: [String: Any],
        overflow: CGSize
    ) -> CGPoint {
        var fallback = CGPoint(x: overflow.width / 2, y: overflow.height / 2)
        if let origin = preview["origin"] as? [String: Any],
           let x = number(origin["x"]), let y = number(origin["y"]) {
            fallback = CGPoint(x: x, y: y)
        }

        let width = number(root["width"]) ?? 0
        let height = number(root["height"]) ?? 0
        let bounds = renderedBounds(root: root, styles: styles)
        let left = bounds.left.rounded(.down)
        let top = bounds.top.rounded(.down)
        let measuredWidth = bounds.right.rounded(.up) - left
        let measuredHeight = bounds.bottom.rounded(.up) - top
        let previewWidth = width + Double(overflow.width)
        let previewHeight = height + Double(overflow.height)

        return CGPoint(
            x: abs(measuredWidth - previewWidth) <= 1 ? -left : Double(fallback.x),
            y: abs(measuredHeight - previewHeight) <= 1 ? -top : Double(fallback.y)
        )
    }

    /// The area the root and its descendants draw into, in the root's
    /// coordinates.
    private static func renderedBounds(
        root: [String: Any],
        styles: [String: Any]
    ) -> (left: Double, top: Double, right: Double, bottom: Double) {
        var minX: Double = 0, minY: Double = 0
        var maxX: Double = number(root["width"]) ?? 0, maxY: Double = number(root["height"]) ?? 0
        func include(_ l: Double, _ t: Double, _ r: Double, _ b: Double) {
            minX = min(minX, l); minY = min(minY, t); maxX = max(maxX, r); maxY = max(maxY, b)
        }
        // Shared values are stored once under `styles` and referenced by key.
        func resolved(_ node: [String: Any], _ field: String) -> Any? {
            if let key = node[field] as? String { return styles[key] }
            return node[field]
        }

        func visit(_ node: [String: Any], _ parentX: Double, _ parentY: Double, isRoot: Bool) {
            let x: Double = parentX + (isRoot ? 0 : (number(node["x"]) ?? 0))
            let y: Double = parentY + (isRoot ? 0 : (number(node["y"]) ?? 0))
            let right: Double = x + (number(node["width"]) ?? 0)
            let bottom: Double = y + (number(node["height"]) ?? 0)

            let effects = resolved(node, "effects") as? [String: Any]
            for shadow in effects?["shadows"] as? [[String: Any]] ?? [] where shadow["inset"] as? Bool != true {
                let dx = number(shadow["x"]) ?? 0
                let dy = number(shadow["y"]) ?? 0
                let reach = (number(shadow["blur"]) ?? 0) + (number(shadow["spread"]) ?? 0)
                include(x + dx - reach, y + dy - reach, right + dx + reach, bottom + dy + reach)
            }
            for border in resolved(node, "borders") as? [[String: Any]] ?? [] {
                let thickness = number(border["thickness"]) ?? 0
                let reach: Double
                switch border["position"] as? String {
                case "outside": reach = thickness
                case "center": reach = thickness / 2
                default: reach = 0
                }
                include(x - reach, y - reach, right + reach, bottom + reach)
            }

            for child in node["children"] as? [[String: Any]] ?? [] {
                visit(child, x, y, isRoot: false)
            }
        }
        visit(root, 0, 0, isRoot: true)
        return (minX, minY, maxX, maxY)
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
