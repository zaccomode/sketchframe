import SwiftUI
import AppKit

/// Syntax-colours pretty-printed JSON for the details pane, in colours
/// modelled on Xcode's default theme. macOS doesn't expose the user's editor
/// theme, so these are fixed, but adapt to light and dark mode.
nonisolated enum JSONHighlighter {
    private static let token = try! NSRegularExpression(
        pattern: #"("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)"#
    )

    static let keyColor = adaptive(light: 0x0F68A0, dark: 0x6BDFFF)
    static let stringColor = adaptive(light: 0xC41A16, dark: 0xFC6A5D)
    static let numberColor = adaptive(light: 0x1C00CF, dark: 0xD0BF69)
    static let constantColor = adaptive(light: 0x9B2393, dark: 0xFC5FA3)

    static func highlight(_ text: String) -> AttributedString {
        let source = text as NSString
        var result = AttributedString()
        var last = 0

        func append(_ range: NSRange, color: Color? = nil) {
            guard range.location != NSNotFound, range.length > 0 else { return }
            var piece = AttributedString(source.substring(with: range))
            if let color { piece.foregroundColor = color }
            result.append(piece)
        }

        for match in token.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            append(NSRange(location: last, length: match.range.location - last))
            let string = match.range(at: 1)
            let colon = match.range(at: 2)
            if string.location != NSNotFound {
                append(string, color: colon.location != NSNotFound ? keyColor : stringColor)
                append(colon)
            } else if match.range(at: 3).location != NSNotFound {
                append(match.range(at: 3), color: constantColor)
            } else {
                append(match.range(at: 4), color: numberColor)
            }
            last = match.range.location + match.range.length
        }
        append(NSRange(location: last, length: source.length - last))
        return result
    }

    private static func adaptive(light: UInt32, dark: UInt32) -> Color {
        func color(_ hex: UInt32) -> NSColor {
            NSColor(
                srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1
            )
        }
        return Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? color(dark) : color(light)
        })
    }
}
