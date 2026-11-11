# Releasing

Sketchframe ships through GitHub Releases. Each release carries these files
under one version:

- `Sketchframe-<version>.zip`: the macOS app, signed with Developer ID,
  notarised and stapled.
- `sketchframe-<version>.sketchplugin.zip`: the Sketch plugin.
- `sketchframe-<version>.vsix`: the VS Code extension. Publishing the release
  also puts this file on the VS Code Marketplace.
- `sketchframe-<version>.tgz`: the `sketchframe` npm package (the CLI and
  MCP server). Publishing the release also puts this file on npm.
- `sketchframe-<version>.cjs`: the CLI and MCP server bundled into one file,
  for repositories that commit it rather than install it from npm.
- `appcast.xml`: the app's Sparkle update feed, listing this version's zip
  and its EdDSA signature.
- `sketchframe-plugin.json`: the plugin's update feed, which Sketch reads.

## Automatic Updates

The app (through Sparkle) and the Sketch plugin (through Sketch's own plugin
updates) both check a feed at a `releases/latest/download/` URL:

- App: `SUFeedURL` in `mac/Sketchframe/Info.plist` →
  `https://github.com/zaccomode/sketchframe/releases/latest/download/appcast.xml`
- Plugin: `appcast` in `plugin/src/manifest.json` →
  `https://github.com/zaccomode/sketchframe/releases/latest/download/sketchframe-plugin.json`

GitHub resolves that URL to the newest **published, full** release. So a
draft offers nothing, a pre-release offers nothing, and publishing a full
release (or unticking "Set as a pre-release") offers the update to every
installed copy. That is the same moment the extension reaches the Marketplace
and the CLI reaches npm.

Both feeds list only their release's version. Sparkle offers the update once
a day, Sketch periodically, and both ask before installing. Copies installed
before these feeds existed (0.6.1 and earlier) have no feed URL, so they
update by hand once.

Sparkle only installs an update whose zip is signed by the private key that
matches the app's `SUPublicEDKey`. `release.yml` signs it with the
`SPARKLE_ED_PRIVATE_KEY` secret, and fails if that key doesn't match the
public key built into the app. Losing the private key means installed copies
can never update automatically again, so keep a copy outside GitHub.

A build without `SPARKLE_PUBLIC_ED_KEY` (on the Sketchframe target) has no
updater at all, and `release.yml` refuses to release one.

Moving to a newer Sparkle means updating the package in Xcode (which updates
`Package.resolved`) and `SPARKLE_VERSION` and `SPARKLE_SHA256` at the top of
`release.yml` together. `release.yml` checks they agree, because the
`sign_update` it downloads from Sparkle's release should match the framework
the app links. Get the hash with
`shasum -a 256 Sparkle-<version>.tar.xz` on the file from
[Sparkle's releases](https://github.com/sparkle-project/Sparkle/releases).

## Cutting a Release

1. Run `scripts/bump-version.sh <version>`, open a pull request with the
   result, and merge it into `main`. The script sets the version in every place
   a release reads it:
   - `MARKETING_VERSION` on every target in the Xcode project (Sketchframe,
     SketchframePreview and SketchframeThumbnail).
   - `version` in `plugin/package.json`, `vscode/package.json`,
     `packages/core/package.json` and `packages/cli/package.json`, and their
     lockfiles.
2. Once CI passes on the merge, `.github/workflows/tag-release.yml` sees that
   `MARKETING_VERSION` changed, tags that commit `v` plus the version, and
   starts `.github/workflows/release.yml` on the tag.
3. `release.yml` checks that the tag, every target's `MARKETING_VERSION`, the
   plugin's, the extension's and the CLI's versions all match. It then builds,
   signs and notarises the app, builds the plugin, tests and packages the
   extension and the CLI, and uploads them all to a **draft** release.
4. Download the files from the draft and check them:
   - Open the app from a fresh download and check Gatekeeper lets it launch
     without a warning.
   - Install the plugin in Sketch.
   - Install the extension with **Extensions → … → Install from VSIX…** and
     open a Sketchframe with it.
   - Run `npx ./sketchframe-<version>.tgz outline Some.sketchframe` (or
     `node sketchframe-<version>.cjs …`) against an export.
   - Check that `appcast.xml` and `sketchframe-plugin.json` are attached and
     name this version.
5. Publish the release in the GitHub UI. This also offers the app and plugin
   update to everyone who has them installed (see Automatic Updates). It starts
   `.github/workflows/publish-extension.yml`, which publishes the release's own
   `.vsix` to the VS Code Marketplace, and `.github/workflows/publish-npm.yml`,
   which publishes its `.tgz` to npm. A release published with **Set as a
   pre-release** ticked stays on GitHub only; unticking it later publishes it
   then.

Pushing a tag by hand still works, and is the fallback if `tag-release.yml`
fails:

```bash
git tag v0.2.0 && git push origin v0.2.0
```

A version bump buried in the middle of a direct push of several commits is
missed by `tag-release.yml`, because it only compares the commit CI ran on with
its parent. In that case run **Actions → Tag release → Run workflow** on
`main`. That path does not wait for CI, so check the head is green first.

To rebuild a release, delete the release (and its tag, if the fix needs a new
commit) in the GitHub UI, then re-run. `release.yml` refuses to start when a
release for the tag already exists, rather than failing after the build.

If the Marketplace publish fails, run **Actions → Publish VS Code extension →
Run workflow** and choose the release's tag in the ref picker. A version can
only be published to the Marketplace once, so a broken extension is fixed with
a new version, not a re-publish. The same goes for npm, with **Actions →
Publish CLI to npm**.

## One-Off Setup

### The `release` Environment

**Settings → Environments → New environment**, named `release`:

- **Deployment branches and tags:** "Selected branches and tags", with a single
  tag rule `v*`. This is what keeps the certificate, and the right to publish
  to the Marketplace, out of reach of a workflow run from any branch.
- **Environment secrets:** the six below. They go on the environment, not on
  the repository, where any workflow on any branch could read them.

| Secret | What it is |
| --- | --- |
| `MAC_CSC_LINK` | A Developer ID Application certificate and its private key, exported from Keychain Access as a `.p12`, then `base64 -i cert.p12 \| pbcopy`. |
| `MAC_CSC_KEY_PASSWORD` | The password the `.p12` was exported with. |
| `APPLE_ID` | The Apple ID email of an account on the team, used for notarisation. |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID, from account.apple.com. |
| `APPLE_TEAM_ID` | The team ID (`NAVFGLVP2P`). |
| `SPARKLE_ED_PRIVATE_KEY` | The Sparkle EdDSA private key that signs app updates. See below. |

The Apple values are the same ones Arborist 2 uses, so they can be copied
across. The Sparkle key is Sketchframe's own.

### The Sparkle Signing Key

Done once. The key never changes afterwards, because every installed copy
trusts only the public key it was built with.

1. Download `Sparkle-<version>.tar.xz` from
   [Sparkle's releases](https://github.com/sparkle-project/Sparkle/releases),
   at the version in `SPARKLE_VERSION` in `release.yml`, and unpack it.
2. Run `./bin/generate_keys --account sketchframe`. It stores the private key
   in your login keychain and prints the public key.
3. Set `SPARKLE_PUBLIC_ED_KEY` to that public key on the **Sketchframe**
   target, in both Debug and Release (**Build Settings → User-Defined**), and
   commit it. It is public, and it is built into the app as `SUPublicEDKey`.
4. Run `./bin/generate_keys --account sketchframe -x sparkle-private-key.txt`,
   paste the file's contents into the `SPARKLE_ED_PRIVATE_KEY` secret, then
   keep the file somewhere safe outside the repository (a password manager)
   and delete the copy on disk.

### The VS Code Marketplace

Publishing uses the Marketplace's Trusted Publishing, so there is no token to
store or renew: the Marketplace trusts one workflow file in this repository,
and GitHub vouches for each run with a short-lived identity token.

1. At [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage),
   sign in with a Microsoft account and create the publisher `zaccomode`. It
   must match `publisher` in `vscode/package.json`.
2. Open the publisher, choose **Trusted Publishing**, and create a policy:
   - **Owner:** `zaccomode`
   - **Repository:** `sketchframe`
   - **Workflow:** `publish-extension.yml`
   - **Environment:** `release`

The policy names the workflow by filename, so renaming
`publish-extension.yml` means updating the policy.

### npm

Publishing uses npm's trusted publishing, so there is no token to store
either. npm only lets a trusted publisher be added to a package that exists,
so the first version is published by hand:

1. Sign in to [npmjs.com](https://www.npmjs.com) with the account that will
   own the `sketchframe` package.
2. Download `sketchframe-<version>.tgz` from the first release with the CLI
   and run `npm publish sketchframe-<version>.tgz --access public`.
3. On the package's **Settings → Trusted publishing**, add a GitHub Actions
   publisher:
   - **Organization or user:** `zaccomode`
   - **Repository:** `sketchframe`
   - **Workflow filename:** `publish-npm.yml`
   - **Environment:** `release`

Until then, `publish-npm.yml` fails without affecting the rest of the
release. The publisher names the workflow by filename, so renaming
`publish-npm.yml` means updating it.

### Runner

Both macOS jobs run on `xcode-27`, GitHub's preview image for Xcode 27,
because the project is in Xcode 27's format and older Xcodes cannot open it.
There is no `macos-27` label: a job that asks for one queues until it times out
instead of failing. Being a preview, the image can queue for longer than the
GA ones while GitHub balances capacity.

They select `/Applications/Xcode_27.1.app` by its exact path, matching the
Xcode used locally. The image also carries release candidates, so picking the
newest `Xcode_27*` would build releases with a pre-release Xcode. When moving
to a newer Xcode, change the path in both `ci.yml` and `release.yml`, and when
the image goes GA (or a `macos-27` label appears), update `runs-on` in both.

The VS Code extension's and the CLI's jobs run on Ubuntu with Node 24. Their
tests run the TypeScript sources directly, which needs Node's built-in type
stripping. CI also runs the CLI's bundle on Node 18, the oldest its
package.json allows.
