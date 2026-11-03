//
//  PreviewViewController.swift
//  SketchframePreview
//
//  Created by Isaac Shea on 3/11/2026.
//

import Cocoa
import Quartz
import SwiftUI

/// Quick Look preview for `.sketchframe` packages: hosts the shared
/// `SketchframeView`.
class PreviewViewController: NSViewController, QLPreviewingController {

    override func loadView() {
        view = NSView()
    }

    func preparePreviewOfFile(at url: URL) async throws {
        let package = try SketchframePackage(contentsOf: url)

        let hostingView = NSHostingView(rootView: SketchframeView(package: package))
        hostingView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hostingView)
        NSLayoutConstraint.activate([
            hostingView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hostingView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hostingView.topAnchor.constraint(equalTo: view.topAnchor),
            hostingView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        preferredContentSize = NSSize(width: 1210, height: 836)
    }
}
