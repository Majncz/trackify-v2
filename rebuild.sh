#!/bin/bash
# Rebuild and restart Trackify production server
# Run this after code changes are made

set -e

echo "🔨 Building Trackify..."
cd /root/trackify
npm run build

echo "🔄 Restarting production server..."
pm2 restart trackify-prod

echo "✅ Done! Trackify is running with the latest changes."
pm2 logs trackify-prod --lines 5 --nostream
