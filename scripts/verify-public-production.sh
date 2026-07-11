#!/bin/bash
set -euo pipefail

PROD_DIR="${PROD_DIR:-/root/trackify-prod}"
PUBLIC_HOST="${PUBLIC_HOST:-trackify.ranajakub.com}"
EXPECTED_MODEL="${EXPECTED_MODEL:-claude-sonnet-5}"
EXPECTED_SHA="$(git -C "$PROD_DIR" rev-parse HEAD)"

fetch_public_route() {
  local path="$1"
  curl -ksSf \
    --connect-timeout 5 \
    --resolve "${PUBLIC_HOST}:443:127.0.0.1" \
    "https://${PUBLIC_HOST}${path}?deploy-check=${EXPECTED_SHA:0:7}"
}

verify_public_model() {
  local response

  for i in {1..20}; do
    response=$(fetch_public_route "/api/chat/model" 2>/dev/null || true)
    if [ -n "$response" ]; then
      RESPONSE="$response" EXPECTED_MODEL="$EXPECTED_MODEL" EXPECTED_SHA="$EXPECTED_SHA" node -e '
        const response = JSON.parse(process.env.RESPONSE);
        if (response.model !== process.env.EXPECTED_MODEL) process.exit(1);
        if (response.gitSha !== process.env.EXPECTED_SHA) process.exit(1);
      ' || {
        echo "ERROR: public chat model endpoint is stale or incorrect"
        echo "       response: $response"
        exit 1
      }

      echo "   Public model route OK: $EXPECTED_MODEL ($EXPECTED_SHA)"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: public /api/chat/model did not respond through Caddy"
  exit 1
}

verify_public_auth() {
  local response expected_url="https://${PUBLIC_HOST}"

  for i in {1..20}; do
    response=$(fetch_public_route "/api/auth/providers" 2>/dev/null || true)
    if [ -n "$response" ]; then
      if [[ "$response" != *"$expected_url"* ]]; then
        echo "ERROR: public auth callbacks do not reference $expected_url"
        echo "       response: $response"
        exit 1
      fi

      echo "   Public auth callbacks OK: $expected_url"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: public /api/auth/providers did not respond through Caddy"
  exit 1
}

verify_public_model
verify_public_auth
