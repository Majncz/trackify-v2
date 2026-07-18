#!/bin/bash
set -euo pipefail

ROOT_DIR="${1:-.}"
cd "$ROOT_DIR"

GIT_SHA=$(git rev-parse HEAD)
GIT_SHA_SHORT=$(git rev-parse --short HEAD)
MODEL=$(grep -o 'CHAT_MODEL_ID = "[^"]*"' src/lib/ai-model.ts | sed 's/.*"\([^"]*\)"/\1/')

if [ -z "$MODEL" ]; then
  echo "ERROR: could not read CHAT_MODEL_ID from src/lib/ai-model.ts"
  exit 1
fi

cat > build-info.json <<EOF
{
  "gitSha": "$GIT_SHA",
  "gitShaShort": "$GIT_SHA_SHORT",
  "model": "$MODEL",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "   Wrote build-info.json ($GIT_SHA_SHORT, $MODEL)"
