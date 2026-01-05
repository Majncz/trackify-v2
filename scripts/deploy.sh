#!/bin/bash
set -e

cd /root/trackify

echo "🛑 Stopping existing server..."
pkill -f 'node dist/index.js' 2>/dev/null || true
sleep 1

echo "🧹 Cleaning old build..."
rm -rf .next

echo "🔨 Building application..."
npm run build

echo "🚀 Starting production server..."
nohup npm run start > /tmp/trackify-prod.log 2>&1 &

echo "⏳ Waiting for server to start..."
sleep 3

# Check if server is running
if pgrep -f 'node dist/index.js' > /dev/null; then
    # Check if it's responding
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo "✅ Deploy successful! Server running at http://localhost:3000"
        echo ""
        echo "Recent logs:"
        tail -5 /tmp/trackify-prod.log
    else
        echo "⚠️  Server started but not responding correctly (HTTP $HTTP_CODE)"
        echo "Check logs: tail -f /tmp/trackify-prod.log"
        exit 1
    fi
else
    echo "❌ Server failed to start!"
    echo "Logs:"
    tail -20 /tmp/trackify-prod.log
    exit 1
fi

