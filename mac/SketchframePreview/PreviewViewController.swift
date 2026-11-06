//
//  PreviewViewController.swift
//  SketchframePreview
//
//  Created by Isaac Shea on 3/11/2026.
//

import Cocoa
import Quartz

/// Quick Look preview for `.sketchframe` files (archives or older folder
/// packages): just the frame's preview image. The inspector and annotations
/// live in the app.
class PreviewViewController: NSViewController, QLPreviewingController {

    override func loadView() {
        view = NSView()
    }

    func preparePreviewOfFile(at url: URL) async throws {
        guard
            let data = SketchframePackage.previewImageData(at: url),
            let bitmap = NSBitmapImageRep(data: data),
            let image = bitmap.cgImage
        else {
            throw CocoaError(.fileReadCorruptFile)
        }

        // Drawn by the layer, aspect-fit to whatever size Quick Look gives the
        // view, so the whole frame is always visible.
        view.wantsLayer = true
        view.layer?.contents = image
        view.layer?.contentsGravity = .resizeAspect

        // The preview is rendered at 2x; ask for its size in points.
        preferredContentSize = NSSize(width: bitmap.pixelsWide / 2, height: bitmap.pixelsHigh / 2)
    }
}
