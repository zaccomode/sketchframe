#!/usr/bin/env bash
# Sets the version everywhere a release reads it: every Xcode target's
# MARKETING_VERSION, the Sketch plugin and the VS Code extension. The release
# workflow refuses to build when these disagree with each other or the tag.
#
#   scripts/bump-version.sh 0.2.0
set -euo pipefail

version="${1:-}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 <major.minor.patch>" >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"

sed -i '' -E "s/MARKETING_VERSION = [^;]+;/MARKETING_VERSION = $version;/" \
  "$root/Sketchframe/Sketchframe.xcodeproj/project.pbxproj"

# --allow-same-version so a re-run, or a package already at the version, isn't an error.
for package in plugin vscode; do
  (cd "$root/$package" && npm version "$version" --no-git-tag-version --allow-same-version > /dev/null)
done

echo "Set the app, plugin and VS Code extension to $version."
