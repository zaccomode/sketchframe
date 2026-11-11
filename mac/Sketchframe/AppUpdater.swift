import Combine
import Sparkle
import SwiftUI

/// Sparkle's updater. It reads its feed from `SUFeedURL` in Info.plist, the
/// appcast.xml that release.yml attaches to each release, and checks it daily
/// once the app has launched.
///
/// It starts only when the build carries a public key (`SPARKLE_PUBLIC_ED_KEY`,
/// substituted into `SUPublicEDKey`). Without one Sparkle refuses every update
/// and says so in an alert at launch, so a build without the key simply has no
/// updater rather than nagging. release.yml refuses to build a release without
/// it.
final class AppUpdater: ObservableObject {
    static let shared = AppUpdater()

    @Published private(set) var canCheckForUpdates = false

    private let controller: SPUStandardUpdaterController?

    private init() {
        let publicKey = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String ?? ""
        guard !publicKey.isEmpty else {
            controller = nil
            return
        }
        let controller = SPUStandardUpdaterController(
            startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil
        )
        self.controller = controller
        controller.updater.publisher(for: \.canCheckForUpdates)
            .assign(to: &$canCheckForUpdates)
    }

    func checkForUpdates() {
        controller?.checkForUpdates(nil)
    }
}

/// The app menu's "Check for Updates…" item.
struct CheckForUpdatesButton: View {
    @ObservedObject var updater: AppUpdater

    var body: some View {
        Button("Check for Updates…") { updater.checkForUpdates() }
            .disabled(!updater.canCheckForUpdates)
    }
}
