# Releasing

Sketchframe ships through GitHub Releases. Each release carries two files under
one version:

- `Sketchframe-<version>.zip`: the macOS app, signed with Developer ID,
  notarised and stapled.
- `sketchframe-<version>.sketchplugin.zip`: the Sketch plugin.

## Cutting a Release

1. Open a pull request that bumps the version in **both** places, and merge it
   into `main`:
   - `MARKETING_VERSION` on every target in the Xcode project (Sketchframe,
     SketchframePreview and SketchframeThumbnail, in their General tabs).
   - `version` in `plugin/package.json` (and `plugin/package-lock.json`, which
     `npm version <version> --no-git-tag-version` in `plugin/` updates along
     with it).
2. Once CI passes on the merge, `.github/workflows/tag-release.yml` sees that
   `MARKETING_VERSION` changed, tags that commit `v` plus the version, and
   starts `.github/workflows/release.yml` on the tag.
3. `release.yml` checks that the tag, every target's `MARKETING_VERSION` and the
   plugin's version all match, then builds, signs, notarises and uploads a
   **draft** release.
4. Download both zips from the draft. Open the app from a fresh download and
   check Gatekeeper lets it launch without a warning, and that the plugin
   installs in Sketch.
5. Publish the release in the GitHub UI.

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

## One-Off Setup

### The `release` Environment

**Settings → Environments → New environment**, named `release`:

- **Deployment branches and tags:** "Selected branches and tags", with a single
  tag rule `v*`. This is what keeps the certificate out of reach of a workflow
  run from any branch.
- **Environment secrets:** the five below. They go on the environment, not on
  the repository, where any workflow on any branch could read them.

| Secret | What it is |
| --- | --- |
| `MAC_CSC_LINK` | A Developer ID Application certificate and its private key, exported from Keychain Access as a `.p12`, then `base64 -i cert.p12 \| pbcopy`. |
| `MAC_CSC_KEY_PASSWORD` | The password the `.p12` was exported with. |
| `APPLE_ID` | The Apple ID email of an account on the team, used for notarisation. |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password for that Apple ID, from account.apple.com. |
| `APPLE_TEAM_ID` | The team ID (`NAVFGLVP2P`). |

These are the same values Arborist 2 uses, so they can be copied across.

### Runner

Both workflows run on `macos-27`, because the project is in Xcode 27's format
and older Xcodes cannot open it. They select the newest `Xcode_27*` on the
image rather than a fixed path, so a point release on the image does not break
the build.
