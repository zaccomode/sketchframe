import SwiftUI
import AppKit

/// A standard macOS segmented control whose segments share the full width
/// available. SwiftUI's segmented `Picker` sizes segments to their content.
struct FillSegmentedControl: NSViewRepresentable {
    struct Segment {
        let symbolName: String
        /// Used for the tooltip and accessibility.
        let label: String
    }

    let segments: [Segment]
    @Binding var selection: Int

    func makeNSView(context: Context) -> NSSegmentedControl {
        let images = segments.map {
            NSImage(systemSymbolName: $0.symbolName, accessibilityDescription: $0.label) ?? NSImage()
        }
        let control = NSSegmentedControl(
            images: images,
            trackingMode: .selectOne,
            target: context.coordinator,
            action: #selector(Coordinator.selectionChanged(_:))
        )
        control.segmentDistribution = .fillEqually
        control.controlSize = .large
        control.setContentHuggingPriority(.defaultLow, for: .horizontal)
        control.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        for (index, segment) in segments.enumerated() {
            control.setToolTip(segment.label, forSegment: index)
        }
        return control
    }

    func updateNSView(_ control: NSSegmentedControl, context: Context) {
        context.coordinator.selection = $selection
        control.selectedSegment = selection
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(selection: $selection)
    }

    @MainActor
    final class Coordinator: NSObject {
        var selection: Binding<Int>

        init(selection: Binding<Int>) {
            self.selection = selection
        }

        @objc func selectionChanged(_ sender: NSSegmentedControl) {
            selection.wrappedValue = sender.selectedSegment
        }
    }
}
