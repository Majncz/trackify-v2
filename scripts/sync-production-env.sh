#!/bin/bash
set -euo pipefail

PROD_DIR="${1:-.}"
ENV_FILE="$PROD_DIR/.env"
EXPECTED_URL="${EXPECTED_URL:-https://trackify.ranajakub.com}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: production environment file not found: $ENV_FILE"
  exit 1
fi

if grep -q '^NEXTAUTH_URL=' "$ENV_FILE"; then
  sed -i.bak "s|^NEXTAUTH_URL=.*|NEXTAUTH_URL=\"$EXPECTED_URL\"|" "$ENV_FILE"
  rm -f "$ENV_FILE.bak"
else
  printf '\nNEXTAUTH_URL="%s"\n' "$EXPECTED_URL" >> "$ENV_FILE"
fi

echo "   Production NEXTAUTH_URL set to $EXPECTED_URL"
