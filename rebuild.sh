#!/bin/bash
# Rebuild and restart Trackify production server
# Run this after code changes are made

set -e

PROD_DIR="/root/trackify-prod"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔨 Building Trackify..."
cd "$PROD_DIR"
git fetch origin master
git reset --hard origin/master
bash "$SCRIPT_DIR/sync-production-env.sh" "$PROD_DIR"
bash "$SCRIPT_DIR/verify-production.sh" source
bash "$SCRIPT_DIR/write-build-info.sh" "$PROD_DIR"
rm -rf .next dist
npm run build
bash "$SCRIPT_DIR/verify-production.sh" compiled

echo "🔄 Restarting production server..."
pm2 startOrReload "$PROD_DIR/ecosystem.config.cjs" --only trackify-prod --update-env
pm2 save
bash "$SCRIPT_DIR/verify-production.sh" pm2
bash "$SCRIPT_DIR/verify-production.sh" runtime
bash "$SCRIPT_DIR/verify-production.sh" auth

echo "✅ Done! Trackify is running with the latest changes."
pm2 logs trackify-prod --lines 5 --nostream
