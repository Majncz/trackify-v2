#!/usr/bin/env bash
set -euo pipefail

NOTE="${1:-chunk complete}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$ROOT_DIR/docs/progress-log.md"

cd "$ROOT_DIR"

STAMP="$(date '+%Y-%m-%d %H:%M:%S %Z')"
COMMIT="$(git rev-parse --short HEAD)"
FILES="$(git show --name-only --pretty='' "$COMMIT" | sed '/^$/d' | head -n 12)"

mkdir -p "$(dirname "$LOG_FILE")"
if [[ ! -f "$LOG_FILE" ]]; then
  cat > "$LOG_FILE" <<'EOF'
# Trackify Desktop Progress Log

EOF
fi

{
  echo "## $STAMP"
  echo "- Commit: [$COMMIT]"
  echo "- Note: $NOTE"
  echo "- Files:"
  while IFS= read -r line; do
    [[ -n "$line" ]] && echo "  - [$line]"
  done <<< "$FILES"
  echo
} >> "$LOG_FILE"

cat <<EOF
Update template:
Chunk done ✅
- Commit: $COMMIT
- Note: $NOTE
- Tests: <fill>
EOF
