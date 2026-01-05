#!/bin/bash
set -e

# Production runs from /root/trackify-prod on port 3000
# Dev runs from /root/trackify on port 3002
PROD_DIR="/root/trackify-prod"
DEV_DIR="/root/trackify"
PORT=3000
LOG_FILE="/tmp/trackify-prod.log"

echo "📦 Deploying to production..."

# Stop existing production server
echo "🛑 Stopping production server..."
pkill -f 'node dist/index.js' 2>/dev/null || true
sleep 2

# Pull latest changes in prod directory
echo "📥 Pulling latest changes..."
cd "$PROD_DIR"
git pull origin master

# Install dependencies if package.json changed
echo "📦 Installing dependencies..."
npm install --production=false

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

# Clean and build
echo "🧹 Cleaning old build..."
rm -rf .next dist

echo "🔨 Building application..."
npm run build

# Start production server
echo "🚀 Starting production server on port $PORT..."
NEXTAUTH_URL="https://time.ranajakub.com" nohup npm run start > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

echo "⏳ Waiting for server to start..."
for i in {1..15}; do
    sleep 1
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/login" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo ""
        echo "✅ Production deployed!"
        echo "   URL: https://time.ranajakub.com"
        echo "   Port: $PORT"
        echo "   PID: $SERVER_PID"
        echo "   Logs: tail -f $LOG_FILE"
        exit 0
    fi
    echo "   Attempt $i/15 (HTTP: $HTTP_CODE)..."
done

echo "❌ Server failed to start!"
echo "Logs:"
tail -30 "$LOG_FILE"
exit 1
