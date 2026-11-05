import Foundation
import CoreGraphics

/// Sketch's corner styles, as design.json names them in `corners.style`.
nonisolated enum CornerStyle: String, Hashable, Sendable {
    case rounded
    case smooth
    case angled
    case insideSquare
    case insideArc
}

/// One step of an outline. Every curve is a cubic Bézier, so the same
/// segments draw as a Core Graphics path here and as SVG in the VS Code
/// extension (vscode/webview/outline.ts).
nonisolated enum OutlineSegment: Equatable, Sendable {
    case move(CGPoint)
    case line(CGPoint)
    case cubic(control1: CGPoint, control2: CGPoint, to: CGPoint)
    case close
}

/// The shape the canvas outlines for a layer: its corners (rounded, smooth,
/// angled, inside square or inside arc, each corner with its own radius), or
/// an ellipse for ovals.
nonisolated enum OutlineShape: Hashable, Sendable {
    case rectangle
    case oval
    /// `radii` are top-left, top-right, bottom-right, bottom-left, as in
    /// `corners.radius`. `smoothing` (0–1) applies to smooth corners.
    case rounded(radii: [CGFloat], style: CornerStyle, smoothing: CGFloat)

    /// Reads the shape from a node's `type` and its (resolved) `corners`
    /// field, as described in docs/FORMAT.md.
    init(type: String, corners: Any?) {
        if type == "oval" {
            self = .oval
            return
        }
        guard let corners = corners as? [String: Any] else {
            self = .rectangle
            return
        }
        var radii: [CGFloat]
        if let radius = corners["radius"] as? NSNumber {
            radii = Array(repeating: CGFloat(radius.doubleValue), count: 4)
        } else if let list = corners["radius"] as? [Any], list.count == 4 {
            let numbers = list.compactMap { ($0 as? NSNumber)?.doubleValue }
            guard numbers.count == 4 else {
                self = .rectangle
                return
            }
            radii = numbers.map { CGFloat($0) }
        } else {
            self = .rectangle
            return
        }
        radii = radii.map { max($0, 0) }
        if radii.allSatisfy({ $0 == 0 }) {
            self = .rectangle
            return
        }
        let styleName = corners["style"] as? String
        let smoothing = (corners["smoothing"] as? NSNumber).map { min(max(CGFloat($0.doubleValue), 0), 1) }
        self = .rounded(
            radii: radii,
            style: styleName.flatMap(CornerStyle.init(rawValue:)) ?? .rounded,
            smoothing: smoothing ?? (styleName == "smooth" ? 0.6 : 0)
        )
    }

    /// The outline in the node's local space (0,0 to width,height).
    func segments(in size: CGSize) -> [OutlineSegment] {
        let w = size.width
        let h = size.height
        switch self {
        case .rectangle:
            return [
                .move(CGPoint(x: 0, y: 0)),
                .line(CGPoint(x: w, y: 0)),
                .line(CGPoint(x: w, y: h)),
                .line(CGPoint(x: 0, y: h)),
                .close,
            ]
        case .oval:
            return Self.ellipse(w, h)
        case .rounded(let radii, let style, let smoothing):
            return Self.roundedRectangle(radii: radii, style: style, smoothing: smoothing, w, h)
        }
    }

    /// The outline in the node's local space, as a path.
    func path(in size: CGSize) -> CGPath {
        let path = CGMutablePath()
        for segment in segments(in: size) {
            switch segment {
            case .move(let point): path.move(to: point)
            case .line(let point): path.addLine(to: point)
            case .cubic(let control1, let control2, let to): path.addCurve(to: to, control1: control1, control2: control2)
            case .close: path.closeSubpath()
            }
        }
        return path
    }

    // MARK: Shapes

    /// Four cubic quarter-arcs: the usual 0.5523 approximation of an ellipse.
    private static func ellipse(_ w: CGFloat, _ h: CGFloat) -> [OutlineSegment] {
        let k: CGFloat = 0.5522847498
        let rx = w / 2
        let ry = h / 2
        return [
            .move(CGPoint(x: rx, y: 0)),
            .cubic(control1: CGPoint(x: rx + rx * k, y: 0), control2: CGPoint(x: w, y: ry - ry * k), to: CGPoint(x: w, y: ry)),
            .cubic(control1: CGPoint(x: w, y: ry + ry * k), control2: CGPoint(x: rx + rx * k, y: h), to: CGPoint(x: rx, y: h)),
            .cubic(control1: CGPoint(x: rx - rx * k, y: h), control2: CGPoint(x: 0, y: ry + ry * k), to: CGPoint(x: 0, y: ry)),
            .cubic(control1: CGPoint(x: 0, y: ry - ry * k), control2: CGPoint(x: rx - rx * k, y: 0), to: CGPoint(x: rx, y: 0)),
            .close,
        ]
    }

    /// Each corner is drawn in a canonical frame where the corner sits at the
    /// origin, the edge arriving at it runs along +x, and the edge leaving it
    /// runs along +y (the top-right corner of a y-down rectangle, travelled
    /// clockwise). `u` and `v` rotate that frame onto the real corner.
    private static func roundedRectangle(
        radii: [CGFloat], style: CornerStyle, smoothing: CGFloat, _ w: CGFloat, _ h: CGFloat
    ) -> [OutlineSegment] {
        let radii = clampRadii(radii, w, h)
        // Clockwise from the top-left; each frame's +x runs along the edge
        // that arrives at the corner.
        let frames: [(origin: CGPoint, u: CGPoint, v: CGPoint)] = [
            (CGPoint(x: 0, y: 0), CGPoint(x: 0, y: -1), CGPoint(x: 1, y: 0)),
            (CGPoint(x: w, y: 0), CGPoint(x: 1, y: 0), CGPoint(x: 0, y: 1)),
            (CGPoint(x: w, y: h), CGPoint(x: 0, y: 1), CGPoint(x: -1, y: 0)),
            (CGPoint(x: 0, y: h), CGPoint(x: -1, y: 0), CGPoint(x: 0, y: -1)),
        ]
        // A smooth corner's curve reaches up to half the shorter side along each edge.
        let budget = min(w, h) / 2

        var segments: [OutlineSegment] = []
        for (index, frame) in frames.enumerated() {
            func map(_ p: CGPoint) -> CGPoint {
                CGPoint(
                    x: frame.origin.x + frame.u.x * p.x + frame.v.x * p.y,
                    y: frame.origin.y + frame.u.y * p.x + frame.v.y * p.y
                )
            }
            let shape = corner(style: style, radius: index < radii.count ? radii[index] : 0, smoothing: smoothing, budget: budget)
            segments.append(index == 0 ? .move(map(shape.start)) : .line(map(shape.start)))
            for segment in shape.rest {
                switch segment {
                case .cubic(let control1, let control2, let to):
                    segments.append(.cubic(control1: map(control1), control2: map(control2), to: map(to)))
                case .line(let to), .move(let to):
                    segments.append(.line(map(to)))
                case .close:
                    break
                }
            }
        }
        segments.append(.close)
        return segments
    }

    /// Scales every radius down by the same factor when two neighbours would
    /// overlap along a side, as CSS `border-radius` does.
    static func clampRadii(_ radii: [CGFloat], _ w: CGFloat, _ h: CGFloat) -> [CGFloat] {
        guard radii.count == 4 else { return radii }
        let (tl, tr, br, bl) = (radii[0], radii[1], radii[2], radii[3])
        let ratios = [(w, tl + tr), (h, tr + br), (w, br + bl), (h, bl + tl)]
            .filter { $0.1 > 0 }
            .map { $0.0 / $0.1 }
        let factor = min(1, ratios.min() ?? 1)
        return radii.map { $0 * factor }
    }

    /// One corner in the canonical frame: a start point at (-reach, 0) on the
    /// arriving edge, then segments ending at (0, reach) on the leaving edge.
    private static func corner(
        style: CornerStyle, radius r: CGFloat, smoothing: CGFloat, budget: CGFloat
    ) -> (start: CGPoint, rest: [OutlineSegment]) {
        guard r > 0 else { return (.zero, []) }
        switch style {
        case .angled:
            return (CGPoint(x: -r, y: 0), [.line(CGPoint(x: 0, y: r))])
        case .insideSquare:
            return (CGPoint(x: -r, y: 0), [.line(CGPoint(x: -r, y: r)), .line(CGPoint(x: 0, y: r))])
        case .insideArc:
            // A concave quarter circle centred on the corner itself.
            return (CGPoint(x: -r, y: 0), [arc(centre: .zero, radius: r, from: .pi, to: .pi / 2)])
        case .rounded:
            return smoothCorner(radius: r, smoothing: 0, budget: budget)
        case .smooth:
            return smoothCorner(radius: r, smoothing: smoothing, budget: budget)
        }
    }

    /// Figma-style corner smoothing (as in the figma-squircle package): the
    /// curve starts further along each edge (by `1 + smoothing` times the
    /// radius), eases in with a cubic, follows a shorter circular arc, and
    /// eases out. With no smoothing it's a plain quarter circle.
    private static func smoothCorner(
        radius: CGFloat, smoothing: CGFloat, budget: CGFloat
    ) -> (start: CGPoint, rest: [OutlineSegment]) {
        let r = min(radius, budget)
        var s = smoothing
        var p = (1 + s) * r
        if p > budget {
            s = max(min(s, budget / r - 1), 0)
            p = min(p, budget)
        }
        let degrees = CGFloat.pi / 180
        let arcMeasure = 90 * (1 - s)
        let arcLength = sin(arcMeasure / 2 * degrees) * r * sqrt(2)
        let alpha = (90 - arcMeasure) / 2
        let p3ToP4 = r * tan(alpha / 2 * degrees)
        let beta = 45 * s
        let c = p3ToP4 * cos(beta * degrees)
        let d = c * tan(beta * degrees)
        let b = (p - arcLength - c - d) / 3
        let a = 2 * b

        let arcStart = CGPoint(x: -p + a + b + c, y: d)
        let arcEnd = CGPoint(x: -d, y: p - a - b - c)
        let centre = CGPoint(x: -r, y: r)
        if s == 0 {
            return (CGPoint(x: -r, y: 0), [arc(centre: centre, radius: r, from: -.pi / 2, to: 0)])
        }
        func angle(_ point: CGPoint) -> CGFloat { atan2(point.y - centre.y, point.x - centre.x) }

        return (CGPoint(x: -p, y: 0), [
            .cubic(control1: CGPoint(x: -p + a, y: 0), control2: CGPoint(x: -p + a + b, y: 0), to: arcStart),
            arc(centre: centre, radius: r, from: angle(arcStart), to: angle(arcEnd)),
            .cubic(control1: CGPoint(x: 0, y: p - a - b), control2: CGPoint(x: 0, y: p - a), to: CGPoint(x: 0, y: p)),
        ])
    }

    /// A circular arc of up to 90° as one cubic, from angle `from` to `to`
    /// (radians, y-down).
    private static func arc(centre: CGPoint, radius r: CGFloat, from: CGFloat, to: CGFloat) -> OutlineSegment {
        let k = 4 / 3 * tan((to - from) / 4)
        let start = CGPoint(x: centre.x + r * cos(from), y: centre.y + r * sin(from))
        let end = CGPoint(x: centre.x + r * cos(to), y: centre.y + r * sin(to))
        return .cubic(
            control1: CGPoint(x: start.x - k * r * sin(from), y: start.y + k * r * cos(from)),
            control2: CGPoint(x: end.x + k * r * sin(to), y: end.y - k * r * cos(to)),
            to: end
        )
    }
}
