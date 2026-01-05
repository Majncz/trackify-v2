#!/bin/bash
set -e

PORT=3002
APP_DIR="/root/trackify"
LOG_FILE="/tmp/trackify-prod.log"

cd "$APP_DIR"

echo "🛑 Stopping existing servers..."
pkill -f 'node dist/index.js' 2>/dev/null || true
pkill -f 'tsx server/index.ts' 2>/dev/null || true
sleep 2

# Double-check port is free
if lsof -i :$PORT > /dev/null 2>&1; then
    echo "⚠️  Port $PORT still in use, force killing..."
    fuser -k $PORT/tcp 2>/dev/null || true
    sleep 1
fi

echo "🧹 Cleaning old build..."
rm -rf .next dist

echo "🔨 Building application..."
npm run build

echo "🚀 Starting production server on port $PORT..."
nohup npm run start > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

echo "⏳ Waiting for server to start..."
for i in {1..10}; do
    sleep 1
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/login" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo "✅ Deploy successful! Server running on port $PORT (PID: $SERVER_PID)"
        echo ""
        echo "Recent logs:"
        tail -5 "$LOG_FILE"
        exit 0
    fi
    echo "   Attempt $i/10 (HTTP: $HTTP_CODE)..."
done

echo "❌ Server failed to start!"
echo "Logs:"
tail -30 "$LOG_FILE"
exit 1
