#!/usr/bin/env bash
#
# Read-only production diagnostics.
#
# This script intentionally does not run npm, Prisma, PM2 mutating commands,
# systemctl reload/restart commands, or database commands.

set -u

PROD_DIR="${PROD_DIR:-/root/trackify-prod}"
DEV_DIR="${DEV_DIR:-/root/trackify}"
PROD_PORT="${PROD_PORT:-3000}"
DEV_PORT="${DEV_PORT:-3002}"
PUBLIC_HOST="${PUBLIC_HOST:-trackify.ranajakub.com}"
EXPECTED_MODEL="${EXPECTED_MODEL:-claude-sonnet-5}"
DIAGNOSTIC_QUERY="${DIAGNOSTIC_QUERY:-$(date +%s)}"

section() {
  printf '\n===== %s =====\n' "$1"
}

report_checkout() {
  local label="$1"
  local directory="$2"

  section "$label checkout"
  if [ ! -d "$directory/.git" ]; then
    echo "directory_missing_or_not_git=$directory"
    return 0
  fi

  printf 'path=%s\n' "$directory"
  printf 'sha='
  git -C "$directory" rev-parse HEAD 2>/dev/null || true
  printf 'branch='
  git -C "$directory" branch --show-current 2>/dev/null || true
  echo "tracked_status:"
  git -C "$directory" status --short --untracked-files=no 2>&1 || true
}

report_pm2() {
  section "PM2 process metadata (sanitized)"
  if ! command -v pm2 >/dev/null 2>&1; then
    echo "pm2=not-installed"
    return 0
  fi

  pm2 jlist 2>/dev/null | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      try {
        const apps = JSON.parse(input);
        for (const app of apps) {
          const env = app.pm2_env || {};
          console.log(JSON.stringify({
            name: app.name ?? null,
            pid: app.pid ?? null,
            status: env.status ?? null,
            cwd: env.pm_cwd || app.pm_cwd || null,
            script: env.pm_exec_path || null,
            args: env.args || null,
            nodeEnv: env.NODE_ENV || null,
            port: env.PORT || null
          }));
        }
      } catch (error) {
        console.log(`pm2_json_error=${error.message}`);
        process.exitCode = 1;
      }
    });
  ' 2>&1 || true
}

report_build_artifacts() {
  section "Model source and build artifacts"
  if [ -f "$PROD_DIR/src/lib/ai-model.ts" ]; then
    echo "source_model_file=$PROD_DIR/src/lib/ai-model.ts"
    grep -n 'CHAT_MODEL_ID' "$PROD_DIR/src/lib/ai-model.ts" 2>&1 || true
  else
    echo "source_model_file_missing=$PROD_DIR/src/lib/ai-model.ts"
  fi

  if [ -f "$PROD_DIR/build-info.json" ]; then
    node -e '
      const fs = require("fs");
      const info = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      console.log(JSON.stringify({
        gitSha: info.gitSha ?? null,
        gitShaShort: info.gitShaShort ?? null,
        model: info.model ?? null,
        builtAt: info.builtAt ?? null
      }));
    ' "$PROD_DIR/build-info.json" 2>&1 || true
  else
    echo "build_info_missing=$PROD_DIR/build-info.json"
  fi

  local compiled_route="$PROD_DIR/.next/server/app/api/chat/route.js"
  if [ -f "$compiled_route" ]; then
    echo "compiled_route=$compiled_route"
    grep -n -m 5 -E 'claude-sonnet-[0-9]+|CHAT_MODEL_ID' "$compiled_route" 2>&1 || \
      echo "compiled_model_text_not_found"
  else
    echo "compiled_route_missing=$compiled_route"
  fi
}

report_network() {
  section "Listening services"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | \
      awk '/:(3000|3002|80|443)([^0-9]|$)/ { print }' || true
  else
    echo "lsof=not-installed"
  fi

  if command -v ps >/dev/null 2>&1; then
    echo "node_processes:"
    ps -eo pid,ppid,user,args 2>/dev/null | \
      awk '/[n]ode|[n]ext|[t]sx/ { print }' || true
  fi
}

report_caddy() {
  section "Caddy routing configuration"
  if [ ! -d /etc/caddy ]; then
    echo "caddy_config_directory_missing=/etc/caddy"
    return 0
  fi

  grep -RInE \
    'trackify\.ranajakub\.com|reverse_proxy|^[[:space:]]*import[[:space:]]' \
    /etc/caddy 2>/dev/null || true

  if command -v caddy >/dev/null 2>&1 && [ -f /etc/caddy/Caddyfile ]; then
    echo "caddy_validate:"
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 || true
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl show caddy \
      --property=ActiveState,SubState,MainPID \
      --no-pager 2>&1 || true
  fi
}

request_endpoint() {
  local label="$1"
  local url="$2"
  local host_header="${3:-}"

  printf '\n--- %s ---\n' "$label"
  printf 'url=%s\n' "$url"

  if [ -n "$host_header" ]; then
    curl -ksS \
      --connect-timeout 5 \
      --max-time 15 \
      -H "Host: $host_header" \
      -D - \
      "$url" 2>&1 || true
  else
    curl -ksS \
      --connect-timeout 5 \
      --max-time 15 \
      -D - \
      "$url" 2>&1 || true
  fi
}

request_caddy_endpoint() {
  local label="$1"
  local url="$2"

  printf '\n--- %s ---\n' "$label"
  printf 'url=%s\n' "$url"
  curl -ksS \
    --connect-timeout 5 \
    --max-time 15 \
    --resolve "${PUBLIC_HOST}:443:127.0.0.1" \
    -D - \
    "$url" 2>&1 || true
}

report_runtime_routes() {
  section "Runtime route comparison"
  local direct_suffix="?diagnostic=$DIAGNOSTIC_QUERY"

  request_endpoint \
    "production port model endpoint" \
    "http://127.0.0.1:${PROD_PORT}/api/chat/model${direct_suffix}" \
    "$PUBLIC_HOST"
  request_endpoint \
    "production port auth providers" \
    "http://127.0.0.1:${PROD_PORT}/api/auth/providers${direct_suffix}" \
    "$PUBLIC_HOST"
  request_endpoint \
    "production port chat route method probe" \
    "http://127.0.0.1:${PROD_PORT}/api/chat${direct_suffix}" \
    "$PUBLIC_HOST"

  request_endpoint \
    "development port model endpoint" \
    "http://127.0.0.1:${DEV_PORT}/api/chat/model${direct_suffix}" \
    "dev.${PUBLIC_HOST}"
  request_endpoint \
    "development port auth providers" \
    "http://127.0.0.1:${DEV_PORT}/api/auth/providers${direct_suffix}" \
    "dev.${PUBLIC_HOST}"

  request_caddy_endpoint \
    "Caddy-local model endpoint" \
    "https://${PUBLIC_HOST}/api/chat/model${direct_suffix}"
  request_caddy_endpoint \
    "Caddy-local auth providers" \
    "https://${PUBLIC_HOST}/api/auth/providers${direct_suffix}"
  request_caddy_endpoint \
    "Caddy-local chat route method probe" \
    "https://${PUBLIC_HOST}/api/chat${direct_suffix}"
}

section "Diagnostic scope"
echo "This run is read-only and does not touch the database."
echo "expected_model=$EXPECTED_MODEL"
echo "public_host=$PUBLIC_HOST"
echo "production_port=$PROD_PORT"
echo "development_port=$DEV_PORT"

report_checkout "Production" "$PROD_DIR"
report_checkout "Development" "$DEV_DIR"
report_build_artifacts
report_pm2
report_network
report_caddy
report_runtime_routes

section "Interpretation"
echo "Compare the model endpoint and auth response at each layer."
echo "A mismatch on production port means the PM2/build layer is stale."
echo "A match on production but mismatch through Caddy means proxy routing is stale."
echo "A match through Caddy but mismatch publicly means DNS, another proxy, or another host is serving traffic."
echo "A 404 for GET /api/chat means the public path is not reaching the Next route; 405 is the expected method-only response."
