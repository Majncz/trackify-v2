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
            actualCwd: app.pid
              ? (() => {
                  try {
                    return require("fs").readlinkSync(`/proc/${app.pid}/cwd`);
                  } catch {
                    return null;
                  }
                })()
              : null,
            script: env.pm_exec_path || null,
            args: env.args || null,
            nodeEnv: env.NODE_ENV || null,
            port: env.PORT || null,
            nextAuthUrl: env.NEXTAUTH_URL || null
          }));
        }
      } catch (error) {
        console.log(`pm2_json_error=${error.message}`);
        process.exitCode = 1;
      }
    });
  ' 2>&1 || true

  for log_file in \
    "/var/log/trackify-prod-error.log" \
    "/var/log/trackify-prod-out.log" \
    "$HOME/.pm2/logs/trackify-prod-error.log" \
    "$HOME/.pm2/logs/trackify-prod-out.log"; do
    if [ -f "$log_file" ]; then
      echo "pm2_log_file=$log_file"
      awk '
        tolower($0) ~ /error|exception|fatal|eaddrinuse|module not found|cannot find|prisma|crash|exit|ready|loaded|unhandled/ {
          print "pm2_log=" substr($0, 1, 1000)
        }
      ' "$log_file" 2>/dev/null || true
    fi
  done
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

  if [ -f "$PROD_DIR/.env" ]; then
    grep -E '^NEXTAUTH_URL=' "$PROD_DIR/.env" 2>&1 || echo "NEXTAUTH_URL=missing"
  else
    echo "production_env_missing=$PROD_DIR/.env"
  fi

  local compiled_route="$PROD_DIR/.next/server/app/api/chat/route.js"
  if [ -f "$compiled_route" ]; then
    echo "compiled_route=$compiled_route"
    grep -n -m 5 -E 'claude-sonnet-[0-9]+|CHAT_MODEL_ID' "$compiled_route" 2>&1 || \
      echo "compiled_model_text_not_found"
  else
    echo "compiled_route_missing=$compiled_route"
  fi

  for manifest in \
    "$PROD_DIR/.next/server/app-paths-manifest.json" \
    "$PROD_DIR/.next/routes-manifest.json"; do
    if [ -f "$manifest" ]; then
      node -e '
        const fs = require("fs");
        const manifestPath = process.argv[1];
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const hasChatModelRoute = Object.keys(manifest).some((key) =>
          key.includes("api/chat/model")
        );
        console.log(`manifest=${manifestPath} hasChatModelRoute=${hasChatModelRoute}`);
      ' "$manifest" 2>&1 || true
    else
      echo "manifest_missing=$manifest"
    fi
  done
}

report_network() {
  section "Listening services"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | \
      awk '/:(3000|3002|80|443)([^0-9]|$)/ { print "listener=" $0 }' || true

    echo "port_3000_owners:"
    while read -r pid; do
      [ -n "$pid" ] || continue
      ps -o pid=,ppid=,user=,args= -p "$pid" 2>/dev/null | \
        awk '{ print "port_owner=" $0 }' || true
      parent_pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d " ")"
      if [ -n "$parent_pid" ]; then
        parent_line="$(ps -o pid=,ppid=,user=,args= -p "$parent_pid" 2>/dev/null || true)"
        printf '%s\n' "$parent_line" | awk '{ print "port_parent=" $0 }'

        if command -v docker >/dev/null 2>&1; then
          container_id="$(
            printf '%s\n' "$parent_line" | \
              sed -n 's/.* -id \([0-9a-f]\{12,\}\) .*/\1/p'
          )"
          if [ -n "$container_id" ]; then
            docker inspect --format \
              'port_container=id={{.Id}} name={{.Name}} image={{.Config.Image}} workdir={{.Config.WorkingDir}} cmd={{json .Config.Cmd}} mounts={{range .Mounts}}{{.Source}}:{{.Destination}};{{end}} labels={{json .Config.Labels}}' \
              "$container_id" 2>&1 || true
          fi
        fi
      fi
    done < <(lsof -t -iTCP:3000 -sTCP:LISTEN 2>/dev/null | sort -u)
  else
    echo "lsof=not-installed"
  fi

  if command -v ps >/dev/null 2>&1; then
    echo "node_processes:"
    ps -eo pid,ppid,user,args 2>/dev/null | \
      awk '/[n]ode|[n]ext|[t]sx/ { print "node_process=" $0 }' || true
  fi

  if command -v docker >/dev/null 2>&1; then
    docker ps --format \
      'docker_container={{.ID}} name={{.Names}} image={{.Image}} ports={{.Ports}}' \
      2>&1 || true
  fi

  local compose_file="/root/dockerized-services/docker-compose.yml"
  if [ -f "$compose_file" ]; then
    grep -nE \
      '^[[:space:]]*trackify-prod:|^[[:space:]]*(container_name|image|build|command|working_dir|ports|volumes|restart|env_file|depends_on):' \
      "$compose_file" 2>/dev/null | \
      awk '{ print "compose=" $0 }' || true
  else
    echo "compose_file_missing=$compose_file"
  fi
}

report_container_auth() {
  section "Docker authentication environment"
  local container="trackify-prod"
  local compose_file="/root/dockerized-services/docker-compose.yml"

  if ! command -v docker >/dev/null 2>&1; then
    echo "docker=not-installed"
    return 0
  fi

  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null | \
    awk '/^NEXTAUTH_URL=/ { print "container_env=" $0 }' || true

  docker exec "$container" sh -c '
    if [ -f /app/.env ]; then
      grep -E "^NEXTAUTH_URL=" /app/.env
    else
      echo "missing=/app/.env"
    fi
  ' 2>/dev/null | awk '{ print "container_app_env=" $0 }' || true

  if [ -f "$compose_file" ]; then
    awk '
      /^[[:space:]]*trackify-prod:[[:space:]]*$/ {
        in_target=1
        print "compose_auth_raw=" NR ": " $0
        next
      }
      in_target && /^[[:space:]]{2}[^[:space:]][^:]*:[[:space:]]*$/ {
        in_target=0
      }
      in_target && /env_file[[:space:]]*:/ {
        print "compose_auth_raw=" NR ": " $0
        for (offset = 1; offset <= 3 && getline next_line > 0; offset++) {
          print "compose_auth_raw=" NR ": " next_line
        }
        next
      }
      in_target && /NEXTAUTH_URL/ {
        print "compose_auth_raw=" NR ": " $0
      }
    ' "$compose_file" 2>/dev/null || true
    for compose_env in \
      "/root/.env" \
      "/root/dockerized-services/.env" \
      "/root/dockerized-services/.env.production" \
      "/root/dockerized-services/.env.prod" \
      "/root/trackify/.env" \
      "/root/trackify-prod/.env"; do
      if [ -f "$compose_env" ]; then
        grep -nE '^NEXTAUTH_URL=' "$compose_env" 2>/dev/null | \
          awk -v file="$compose_env" '{ print "compose_dotenv=" file ":" $0 }' || true
      fi
    done
    docker compose -f "$compose_file" config --environment 2>/dev/null | \
      awk '/NEXTAUTH_URL/ { print "compose_environment=" $0 }' || true
    docker compose -f "$compose_file" config 2>/dev/null | \
      awk '/NEXTAUTH_URL|env_file/ { print "compose_auth=" $0 }' || true
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
report_container_auth
report_caddy
report_runtime_routes

section "Interpretation"
echo "Compare the model endpoint and auth response at each layer."
echo "A mismatch on production port means the PM2/build layer is stale."
echo "A match on production but mismatch through Caddy means proxy routing is stale."
echo "A match through Caddy but mismatch publicly means DNS, another proxy, or another host is serving traffic."
echo "A 404 for GET /api/chat means the public path is not reaching the Next route; 405 is the expected method-only response."
