#!/bin/bash
set -euo pipefail

PROD_DIR="${PROD_DIR:-/root/trackify-prod}"
PORT="${PORT:-3000}"
PM2_APP="${PM2_APP:-trackify-prod}"
EXPECTED_MODEL="${EXPECTED_MODEL:-claude-sonnet-5}"

verify_source_model() {
  if ! grep -q "CHAT_MODEL_ID = \"$EXPECTED_MODEL\"" "$PROD_DIR/src/lib/ai-model.ts"; then
    echo "ERROR: source model is not $EXPECTED_MODEL"
    exit 1
  fi
  echo "   Source model OK: $EXPECTED_MODEL"
}

verify_compiled_model() {
  if ! grep -q "$EXPECTED_MODEL" "$PROD_DIR/.next/server/app/api/chat/route.js"; then
    echo "ERROR: compiled chat route missing $EXPECTED_MODEL"
    exit 1
  fi
  echo "   Compiled chat route OK: $EXPECTED_MODEL"
}

verify_pm2_cwd() {
  local pm2_cwd
  pm2_cwd=$(pm2 jlist | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const apps = JSON.parse(input);
      const app = apps.find((candidate) => candidate.name === process.argv[1]);
      process.stdout.write(app?.pm2_env?.pm_cwd || app?.pm_cwd || "");
    });
  ' "$PM2_APP")

  if [ "$pm2_cwd" != "$PROD_DIR" ]; then
    echo "ERROR: $PM2_APP cwd is '${pm2_cwd:-unknown}', expected $PROD_DIR"
    exit 1
  fi

  echo "   PM2 cwd OK: $pm2_cwd"
}

verify_runtime_model() {
  local expected_sha response model git_sha
  expected_sha=$(git -C "$PROD_DIR" rev-parse HEAD)

  for i in {1..15}; do
    response=$(curl -sf "http://127.0.0.1:${PORT}/api/chat/model" 2>/dev/null || true)
    if [ -n "$response" ]; then
      model=$(printf '%s' "$response" | sed -n 's/.*"model":"\([^"]*\)".*/\1/p')
      git_sha=$(printf '%s' "$response" | sed -n 's/.*"gitSha":"\([^"]*\)".*/\1/p')

      if [ "$model" != "$EXPECTED_MODEL" ]; then
        echo "ERROR: runtime model is '$model', expected $EXPECTED_MODEL"
        echo "       response: $response"
        exit 1
      fi

      if [ "$git_sha" != "$expected_sha" ]; then
        echo "ERROR: runtime gitSha is '$git_sha', expected $expected_sha"
        echo "       response: $response"
        exit 1
      fi

      echo "   Runtime model OK: $model"
      echo "   Runtime gitSha OK: $git_sha"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: /api/chat/model did not respond on port $PORT"
  exit 1
}

case "${1:-all}" in
  source)
    verify_source_model
    ;;
  compiled)
    verify_compiled_model
    ;;
  pm2)
    verify_pm2_cwd
    ;;
  runtime)
    verify_runtime_model
    ;;
  all)
    verify_source_model
    verify_compiled_model
    verify_pm2_cwd
    verify_runtime_model
    ;;
  *)
    echo "Usage: $0 [source|compiled|pm2|runtime|all]"
    exit 1
    ;;
esac
