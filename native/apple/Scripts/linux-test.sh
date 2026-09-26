#!/usr/bin/env bash
# Build + test TrackifyKit on Linux in Docker (fast loop for non-UI code).
#   Scripts/linux-test.sh            # unit tests
#   TRACKIFY_LIVE=1 Scripts/linux-test.sh --filter LiveServerTests
set -euo pipefail
PKG="$(cd "$(dirname "$0")/../Packages/TrackifyKit" && pwd)"
exec docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e TRACKIFY_LIVE="${TRACKIFY_LIVE:-}" \
  -v "$PKG":/w -w /w swift:6.1-noble swift test --scratch-path /w/.build "$@"
