//
//  ThumbnailProvider.swift
//  SketchframeThumbnail
//
//  Created by Isaac Shea on 3/11/2026.
//

import QuickLookThumbnailing

/// Finder thumbnails for `.sketchframe` packages: the package's own preview PNG.
class ThumbnailProvider: QLThumbnailProvider {

    override func provideThumbnail(for request: QLFileThumbnailRequest, _ handler: @escaping (QLThumbnailReply?, Error?) -> Void) {
        let packageURL = request.fileURL
        let designURL = packageURL.appending(path: SketchframePackage.designFileName)
        let previewFileName = (try? Data(contentsOf: designURL))
            .map(SketchframePackage.previewFileName(in:))
            ?? SketchframePackage.defaultPreviewFileName
        let previewURL = packageURL.appending(path: previewFileName)

        guard FileManager.default.fileExists(atPath: previewURL.path(percentEncoded: false)) else {
            handler(nil, CocoaError(.fileNoSuchFile))
            return
        }
        handler(QLThumbnailReply(imageFileURL: previewURL), nil)
    }
}
