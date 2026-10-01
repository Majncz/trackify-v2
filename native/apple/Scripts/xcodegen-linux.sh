#!/usr/bin/env bash
# Run XcodeGen on Linux via Docker (for the Linux dev box; macOS just uses `xcodegen generate`).
#   XCODEGEN_DIR=/path/to/XcodeGen Scripts/xcodegen-linux.sh
set -euo pipefail
APPLE="$(cd "$(dirname "$0")/.." && pwd)"
XG="${XCODEGEN_DIR:?set XCODEGEN_DIR to a built XcodeGen checkout}"
exec docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e USER="$(id -un)" -v /etc/passwd:/etc/passwd:ro -v "$XG":/w:ro -v "$APPLE":/p -w /p swift:6.1-noble \
  /w/.build/release/xcodegen generate --spec /p/project.yml
