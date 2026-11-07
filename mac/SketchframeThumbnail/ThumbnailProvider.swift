//
//  ThumbnailProvider.swift
//  SketchframeThumbnail
//
//  Created by Isaac Shea on 3/11/2026.
//

import QuickLookThumbnailing
import ImageIO

/// Finder thumbnails for `.sketchframe` files (archives or older folder
/// packages): the Sketchframe's own preview PNG, decoded at the requested size
/// and drawn aspect-fit, so small list-view icons don't decode the full @2x
/// image.
class ThumbnailProvider: QLThumbnailProvider {

    override func provideThumbnail(for request: QLFileThumbnailRequest, _ handler: @escaping (QLThumbnailReply?, Error?) -> Void) {
        // Decode only as many pixels as the largest thumbnail needs.
        let maxPixels = max(request.maximumSize.width, request.maximumSize.height) * request.scale
        guard
            let previewData = SketchframePackage.previewImageData(at: request.fileURL),
            let source = CGImageSourceCreateWithData(previewData as CFData, nil),
            let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: max(maxPixels, 1),
            ] as CFDictionary)
        else {
            handler(nil, CocoaError(.fileReadCorruptFile))
            return
        }

        // Aspect-fit the image inside the requested size.
        let imageSize = CGSize(width: image.width, height: image.height)
        let fit = min(
            request.maximumSize.width / max(imageSize.width, 1),
            request.maximumSize.height / max(imageSize.height, 1)
        )
        let contextSize = CGSize(
            width: max((imageSize.width * fit).rounded(), 1),
            height: max((imageSize.height * fit).rounded(), 1)
        )

        handler(QLThumbnailReply(contextSize: contextSize) { context in
            context.interpolationQuality = .high
            context.draw(image, in: CGRect(origin: .zero, size: contextSize))
            return true
        }, nil)
    }
}
