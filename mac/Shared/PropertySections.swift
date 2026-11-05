import Foundation
import CoreFoundation

/// One labelled value in the inspector's Properties view. Clicking the row
/// copies `value`.
nonisolated struct PropertyRow: Hashable, Sendable {
    var label: String
    var value: String
    /// CSS colors for a swatch: one for a solid color, the stops of a gradient.
    var swatch: [String] = []
    /// The color token the value comes from.
    var token: String?
    /// Long or multi-line text (text content, CSS), shown under the label.
    var isBlock = false
}

nonisolated struct PropertySection: Hashable, Sendable {
    let title: String
    let rows: [PropertyRow]
}

/// A node's (or a style's) design.json fields, grouped and labelled for the
/// inspector's Properties view, roughly as Figma's Dev Mode lays them out.
/// Mirrors vscode/webview/properties.ts; the JSON view still shows
/// everything verbatim.
nonisolated enum PropertySections {
    typealias Object = [String: Any]

    /// Sections for a node's resolved fields (style keys already replaced by
    /// their values).
    static func node(_ node: Object) -> [PropertySection] {
        [
            section("Layer", layerRows(node)),
            section("Position & Size", layoutRows(node)),
            section("Auto Layout", stackRows(node["layout"])),
            section("Appearance", appearanceRows(node)),
            section("Text", textRows(node)),
            section("Typography", typographyRows(node["textStyle"])),
            section("Fills", paintRows(node["fills"])),
            section("Borders", borderRows(node["borders"], options: node["borderOptions"])),
            section("Effects", effectRows(node["effects"])),
            section("Overrides", overrideRows(node["overrides"])),
        ]
        .filter { !$0.rows.isEmpty }
    }

    /// Sections for a value in design.json's `styles` map. Its key's prefix
    /// says which node field it stands in for.
    static func style(category: String?, value: Any) -> [PropertySection] {
        let fields = [
            "fill": "fills", "border": "borders", "effect": "effects",
            "corner": "corners", "layout": "layout", "text": "textStyle",
        ]
        guard let category, let field = fields[category] else { return [] }
        return node([field: value])
    }

    /// Sections for a color token.
    static func token(name: String, value: String, layers: [String]) -> [PropertySection] {
        [
            section("Color", [PropertyRow(label: name, value: value, swatch: [value])] + colorFormats(value)),
            section("Used By", layers.enumerated().map { PropertyRow(label: "\($0.offset + 1)", value: $0.element) }),
        ]
        .filter { !$0.rows.isEmpty }
    }

    // MARK: Sections

    private static func section(_ title: String, _ rows: [PropertyRow?]) -> PropertySection {
        PropertySection(title: title, rows: rows.compactMap { $0 })
    }

    private static func row(
        _ label: String, _ value: String?, swatch: [String] = [], token: String? = nil, isBlock: Bool = false
    ) -> PropertyRow? {
        guard let value, !value.isEmpty else { return nil }
        return PropertyRow(label: label, value: value, swatch: swatch, token: token, isBlock: isBlock)
    }

    private static func layerRows(_ node: Object) -> [PropertyRow?] {
        [
            row("Type", string(node["type"])),
            row("Component", string(node["component"])),
            row("Shared style", string(node["sharedStyle"])),
            row("Asset", string(node["src"])),
        ]
    }

    private static func layoutRows(_ node: Object) -> [PropertyRow?] {
        let flips = [isTrue(node["flipX"]) ? "horizontal" : nil, isTrue(node["flipY"]) ? "vertical" : nil]
            .compactMap { $0 }
        let sizing = node["sizing"] as? Object
        let constraints = node["constraints"] as? Object
        return [
            row("Width", px(node["width"])),
            row("Height", px(node["height"])),
            row("X", px(node["x"])),
            row("Y", px(node["y"])),
            row("Rotation", number(node["rotation"]).map { "\(decimal($0))°" }),
            row("Flipped", flips.joined(separator: ", ")),
            row("Position", string(node["position"])),
            row("Horizontal sizing", string(sizing?["horizontal"])),
            row("Vertical sizing", string(sizing?["vertical"])),
            row("Min size", sizeText(node["minSize"])),
            row("Max size", sizeText(node["maxSize"])),
            row("Size %", sizeText(node["percentageSize"]) { "\(decimal($0 * 100))%" }),
            row("Horizontal constraint", string(constraints?["horizontal"])),
            row("Vertical constraint", string(constraints?["vertical"])),
            row("Clip content", isTrue(node["clipContent"]) ? "Yes" : nil),
        ]
    }

    private static func stackRows(_ value: Any?) -> [PropertyRow?] {
        guard let layout = value as? Object else { return [] }
        return [
            row("Direction", string(layout["mode"]) == "column" ? "Vertical (column)" : "Horizontal (row)"),
            row("Gap", px(layout["gap"])),
            row("Padding", string(layout["padding"])),
            row("Justify content", string(layout["justifyContent"])),
            row("Align items", string(layout["alignItems"])),
            row("Wrap", isTrue(layout["wrap"]) ? "Yes" : nil),
            row("Align content", string(layout["alignContent"])),
            row("Cross-axis gap", px(layout["crossAxisGap"])),
            row("Stacking order", string(layout["stackingOrder"]) == "firstOnTop" ? "First on top" : nil),
            row("Borders affect layout", isTrue(layout["bordersAffectLayout"]) ? "Yes" : nil),
        ]
    }

    private static let cornerStyleNames = [
        "smooth": "Smooth",
        "angled": "Angled",
        "insideSquare": "Inside square",
        "insideArc": "Inside arc",
    ]

    private static func appearanceRows(_ node: Object) -> [PropertyRow?] {
        let corners = node["corners"] as? Object
        var radius: String?
        if let value = number(corners?["radius"]) {
            radius = px(value)
        } else if let list = corners?["radius"] as? [Any] {
            radius = list.map { px($0) ?? "0" }.joined(separator: " ")
        }
        let style = string(corners?["style"])
        return [
            row("Opacity", number(node["opacity"]).map { "\(decimal($0 * 100))%" }),
            row("Blend mode", string(node["blendMode"])),
            row("Corner radius", radius),
            row("Corner style", style.map { cornerStyleNames[$0] ?? $0 }),
            row("Smoothing", number(corners?["smoothing"]).map { "\(decimal($0 * 100))%" }),
            row("Concentric", isTrue(corners?["concentric"]) ? "Yes" : nil),
        ]
    }

    private static func textRows(_ node: Object) -> [PropertyRow?] {
        let runs = (node["textRuns"] as? [Any])?.count ?? 0
        return [
            row("Content", string(node["text"]), isBlock: true),
            row("Behaviour", string(node["textBehaviour"])),
            row("Styled runs", runs > 0 ? "\(runs)" : nil),
        ]
    }

    private static func typographyRows(_ value: Any?) -> [PropertyRow?] {
        guard let text = value as? Object else { return [] }
        let lineHeight = isTrue(text["lineHeightAuto"])
            ? "Auto (\(px(text["lineHeight"]) ?? "—"))"
            : px(text["lineHeight"])
        return [
            row("Font", string(text["fontFamily"])),
            row("Font name", string(text["fontName"])),
            row("Weight", number(text["fontWeight"]).map(decimal)),
            row("Style", string(text["fontStyle"])),
            row("Size", px(text["fontSize"])),
            row("Line height", lineHeight),
            row("Letter spacing", px(text["letterSpacing"])),
            row("Paragraph spacing", px(text["paragraphSpacing"])),
            row("Align", string(text["textAlign"])),
            row("Vertical align", string(text["verticalAlign"])),
            row("Transform", string(text["textTransform"])),
            row("Decoration", string(text["textDecoration"])),
            colorRow("Color", string(text["color"]), token: string(text["colorToken"])),
        ]
    }

    private static func paintRows(_ value: Any?) -> [PropertyRow?] {
        objects(value).map { paintRow($0) }
    }

    private static func paintRow(_ paint: Object, prefix: String = "") -> PropertyRow? {
        let type = string(paint["type"]) ?? "solid"
        let suffix = string(paint["blendMode"]).map { " · \($0)" } ?? ""
        switch type {
        case "solid":
            return colorRow("\(prefix)Solid\(suffix)", string(paint["color"]), token: string(paint["token"]))
        case "image":
            let text = [string(paint["fit"]), string(paint["src"])].compactMap { $0 }.joined(separator: " · ")
            return row("\(prefix)Image\(suffix)", text)
        default:
            let stops = objects(paint["stops"])
            let approximate = isTrue(paint["approximate"]) ? " (approx.)" : ""
            let name = "\(type.prefix(1).uppercased())\(type.dropFirst()) gradient\(approximate)"
            let css = string(paint["css"]) ?? stops.map {
                "\(string($0["color"]) ?? "") \(decimal((number($0["position"]) ?? 0) * 100))%"
            }.joined(separator: ", ")
            return row(
                "\(prefix)\(name)\(suffix)",
                css,
                swatch: stops.compactMap { string($0["color"]) },
                isBlock: true
            )
        }
    }

    private static func borderRows(_ value: Any?, options optionsValue: Any?) -> [PropertyRow?] {
        var rows: [PropertyRow?] = objects(value).map { border in
            var sideText = ""
            if let sides = border["sides"] as? Object {
                let shown = ["top", "right", "bottom", "left"].filter { side in
                    // Hidden sides are `false` or `0`; anything else draws.
                    guard let flag = sides[side] as? NSNumber else { return true }
                    return flag.doubleValue != 0
                }
                sideText = " (\(shown.joined(separator: ", ")))"
            }
            let prefix = "\(px(border["thickness"]) ?? "") \(string(border["position"]) ?? "")\(sideText) · "
            return paintRow(border, prefix: String(prefix.drop(while: { $0 == " " })))
        }
        if let options = optionsValue as? Object {
            let dash = (options["dashPattern"] as? [Any])?.map { number($0).map(decimal) ?? "0" }.joined(separator: " ")
            rows += [
                row("Dash pattern", dash),
                row("Line cap", string(options["lineCap"])),
                row("Line join", string(options["lineJoin"])),
                row("Start arrowhead", string(options["startArrowhead"])),
                row("End arrowhead", string(options["endArrowhead"])),
            ]
        }
        return rows
    }

    private static func effectRows(_ value: Any?) -> [PropertyRow?] {
        guard let effects = value as? Object else { return [] }
        let shadows: [PropertyRow?] = objects(effects["shadows"]).map { shadow in
            let offsets = ["x", "y", "blur", "spread"].map { px(shadow[$0]) ?? "0" }.joined(separator: " ")
            return colorRow(
                isTrue(shadow["inset"]) ? "Inner shadow" : "Drop shadow",
                string(shadow["color"]),
                token: string(shadow["token"]),
                detail: offsets
            )
        }
        let blurs: [PropertyRow?] = objects(effects["blurs"]).map { blur in
            let type = string(blur["type"]) ?? "gaussian"
            var details = [px(blur["radius"])]
            if let angle = number(blur["angle"]) { details.append("\(decimal(angle))°") }
            if blur["progressive"] != nil { details.append("progressive") }
            return row(
                "\(type.prefix(1).uppercased())\(type.dropFirst()) blur",
                details.compactMap { $0 }.joined(separator: " · ")
            )
        }
        let css = (effects["css"] as? Object ?? [:])
            .sorted { cssOrder($0.key) < cssOrder($1.key) }
            .map { row(cssName($0.key), string($0.value), isBlock: true) }
        return shadows + blurs + css
    }

    /// The order the exporter writes `effects.css` in, which JSONSerialization loses.
    private static func cssOrder(_ key: String) -> Int {
        ["boxShadow", "textShadow", "filter", "backdropFilter"].firstIndex(of: key) ?? 4
    }

    private static func overrideRows(_ value: Any?) -> [PropertyRow?] {
        objects(value).map { override in
            let label = [string(override["layer"]), string(override["property"])]
                .compactMap { $0 }
                .joined(separator: " · ")
            let text = string(override["value"]) ?? compactJSON(override["value"])
            let swatch = string(override["value"]).flatMap { parseColor($0) == nil ? nil : [$0] } ?? []
            return row(label.isEmpty ? "Override" : label, text, swatch: swatch)
        }
    }

    // MARK: Colors

    /// A color row copies the hex (or rgba) value. `detail` goes before the
    /// color, as for a shadow's offsets.
    private static func colorRow(_ label: String, _ color: String?, token: String?, detail: String? = nil) -> PropertyRow? {
        guard let color else { return nil }
        return row(label, detail.map { "\($0) \(color)" } ?? color, swatch: [color], token: token)
    }

    /// Hex, RGB(A) and HSL forms of a CSS color, for copying in whichever a
    /// codebase uses.
    static func colorFormats(_ css: String) -> [PropertyRow] {
        guard let color = parseColor(css) else { return [] }
        let (r, g, b, a) = color
        let hex = "#" + [r, g, b].map { String(format: "%02X", $0) }.joined()
        let alphaHex = a < 1 ? hex + String(format: "%02X", Int((a * 255).rounded())) : hex
        let (h, s, l) = hsl(r, g, b)
        return [
            PropertyRow(label: "Hex", value: alphaHex),
            PropertyRow(label: "RGB", value: a < 1 ? "rgba(\(r), \(g), \(b), \(decimal(a)))" : "rgb(\(r), \(g), \(b))"),
            PropertyRow(label: "HSL", value: a < 1 ? "hsla(\(h), \(s)%, \(l)%, \(decimal(a)))" : "hsl(\(h), \(s)%, \(l)%)"),
        ]
    }

    /// `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(…)` and `rgba(…)`, as 0–255
    /// channels and 0–1 alpha.
    static func parseColor(_ css: String) -> (r: Int, g: Int, b: Int, a: Double)? {
        let value = css.trimmingCharacters(in: .whitespaces).lowercased()
        if value.hasPrefix("#") {
            var hex = String(value.dropFirst())
            if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
            guard hex.count == 6 || hex.count == 8, let bits = UInt64(hex, radix: 16) else { return nil }
            if hex.count == 6 {
                return (Int(bits >> 16 & 0xff), Int(bits >> 8 & 0xff), Int(bits & 0xff), 1)
            }
            return (Int(bits >> 24 & 0xff), Int(bits >> 16 & 0xff), Int(bits >> 8 & 0xff), Double(bits & 0xff) / 255)
        }
        guard value.hasPrefix("rgb"), value.hasSuffix(")"), let open = value.firstIndex(of: "(") else { return nil }
        let name = value[..<open]
        guard name == "rgb" || name == "rgba" else { return nil }
        let parts = value[value.index(after: open)..<value.index(before: value.endIndex)]
            .split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" })
            .map { Double($0) }
        guard parts.count == 3 || parts.count == 4, parts.allSatisfy({ $0 != nil }) else { return nil }
        let numbers = parts.compactMap { $0 }
        return (Int(numbers[0]), Int(numbers[1]), Int(numbers[2]), numbers.count == 4 ? numbers[3] : 1)
    }

    private static func hsl(_ r: Int, _ g: Int, _ b: Int) -> (Int, Int, Int) {
        let (rf, gf, bf) = (Double(r) / 255, Double(g) / 255, Double(b) / 255)
        let maxValue = max(rf, gf, bf)
        let minValue = min(rf, gf, bf)
        let l = (maxValue + minValue) / 2
        let d = maxValue - minValue
        var h = 0.0
        var s = 0.0
        if d != 0 {
            s = d / (1 - abs(2 * l - 1))
            if maxValue == rf {
                h = 60 * ((gf - bf) / d).truncatingRemainder(dividingBy: 6)
            } else if maxValue == gf {
                h = 60 * ((bf - rf) / d + 2)
            } else {
                h = 60 * ((rf - gf) / d + 4)
            }
        }
        if h < 0 { h += 360 }
        return (Int(h.rounded()), Int((s * 100).rounded()), Int((l * 100).rounded()))
    }

    // MARK: Helpers

    private static func objects(_ value: Any?) -> [Object] {
        (value as? [Any])?.compactMap { $0 as? Object } ?? []
    }

    private static func string(_ value: Any?) -> String? {
        guard let string = value as? String, !string.isEmpty else { return nil }
        return string
    }

    /// Numbers only: JSONSerialization hands back booleans as NSNumbers too.
    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        return number.doubleValue
    }

    private static func isTrue(_ value: Any?) -> Bool {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return false }
        return number.boolValue
    }

    /// Up to two decimal places, without trailing zeros.
    static func decimal(_ value: Double) -> String {
        let rounded = (value * 100).rounded() / 100
        if rounded == rounded.rounded() { return String(Int(rounded)) }
        var text = String(format: "%.2f", rounded)
        while text.hasSuffix("0") { text.removeLast() }
        return text
    }

    private static func px(_ value: Any?) -> String? {
        number(value).map { "\(decimal($0))px" }
    }

    private static func sizeText(
        _ value: Any?, format formatter: (Double) -> String = { "\(PropertySections.decimal($0))px" }
    ) -> String? {
        guard let size = value as? Object else { return nil }
        let w = number(size["width"])
        let h = number(size["height"])
        if w == nil, h == nil { return nil }
        return "\(w.map(formatter) ?? "—") × \(h.map(formatter) ?? "—")"
    }

    /// `boxShadow` → `box-shadow`.
    private static func cssName(_ key: String) -> String {
        key.map { $0.isUppercase ? "-\($0.lowercased())" : String($0) }.joined()
    }

    private static func compactJSON(_ value: Any?) -> String? {
        guard let value else { return nil }
        if let number = value as? NSNumber {
            return CFGetTypeID(number) == CFBooleanGetTypeID() ? (number.boolValue ? "true" : "false") : decimal(number.doubleValue)
        }
        guard
            JSONSerialization.isValidJSONObject(value),
            let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
        else { return nil }
        return String(decoding: data, as: UTF8.self)
    }
}
