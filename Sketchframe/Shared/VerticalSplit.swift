import SwiftUI
import AppKit

/// A top/bottom split that starts at `initialFraction` and can be dragged.
/// `VSplitView` ignores ideal sizes, so its initial split is unpredictable.
struct VerticalSplit<Top: View, Bottom: View>: View {
    var initialFraction: CGFloat = 0.5
    var minHeight: CGFloat = 100
    @ViewBuilder let top: Top
    @ViewBuilder let bottom: Bottom

    @State private var fraction: CGFloat?
    @State private var dragStartFraction: CGFloat?

    var body: some View {
        GeometryReader { geometry in
            let height = geometry.size.height
            let current = clamped(fraction ?? initialFraction, height: height)

            VStack(spacing: 0) {
                top
                    .frame(height: max(height * current - 0.5, 0))
                Divider()
                    .overlay {
                        // A taller, invisible handle that's easier to grab.
                        Color.clear
                            .frame(height: 8)
                            .contentShape(Rectangle())
                            .onHover { inside in
                                if inside { NSCursor.resizeUpDown.push() } else { NSCursor.pop() }
                            }
                            .gesture(
                                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                                    .onChanged { value in
                                        let start = dragStartFraction ?? current
                                        dragStartFraction = start
                                        fraction = clamped(start + value.translation.height / max(height, 1), height: height)
                                    }
                                    .onEnded { _ in dragStartFraction = nil }
                            )
                    }
                bottom
                    .frame(maxHeight: .infinity)
            }
        }
    }

    private func clamped(_ value: CGFloat, height: CGFloat) -> CGFloat {
        guard height > minHeight * 2 else { return 0.5 }
        let limit = minHeight / height
        return min(max(value, limit), 1 - limit)
    }
}
