#!/bin/bash
# Rebuild and restart Trackify production server
# Run this after code changes are made

set -e

echo "🔨 Building Trackify..."
cd /root/trackify-prod
git fetch origin master
git reset --hard origin/master
rm -rf .next dist
npm run build

echo "🔄 Restarting production server..."
pm2 startOrReload ecosystem.config.cjs --only trackify-prod --update-env
pm2 save

echo "✅ Done! Trackify is running with the latest changes."
pm2 logs trackify-prod --lines 5 --nostream
