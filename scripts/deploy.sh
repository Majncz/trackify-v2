#!/bin/bash
set -e

# Full deployment workflow:
# 1. Commit & push changes from dev directory
# 2. Pull latest in prod directory
# 3. Build & start production server

DEV_DIR="/root/trackify"
PROD_DIR="/root/trackify-prod"
PORT=3000
LOG_FILE="/tmp/trackify-prod.log"

echo "🚀 Trackify Deployment"
echo "======================"
echo ""

# Step 1: Commit and push from dev directory
echo "📝 Step 1: Committing changes..."
cd "$DEV_DIR"

if [[ -n $(git status --porcelain) ]]; then
    git add -A
    
    # Get commit message from argument or use default
    COMMIT_MSG="${1:-Auto-deploy $(date '+%Y-%m-%d %H:%M')}"
    
    git commit -m "$COMMIT_MSG"
    echo "   Committed: $COMMIT_MSG"
else
    echo "   No changes to commit"
fi

echo ""
echo "📤 Step 2: Pushing to GitHub..."
git push origin master
echo "   Pushed to origin/master"

# Step 3: Stop existing production server
echo ""
echo "🛑 Step 3: Stopping production server..."
pkill -f 'node dist/server/index.js' 2>/dev/null || true
sleep 2

# Step 4: Pull latest changes in prod directory
echo ""
echo "📥 Step 4: Pulling latest in production..."
cd "$PROD_DIR"
git fetch origin
git reset --hard origin/master
echo "   Updated to $(git rev-parse --short HEAD)"

# Step 5: Install dependencies
echo ""
echo "📦 Step 5: Installing dependencies..."
npm install --silent

# Step 6: Generate Prisma client
echo ""
echo "🔧 Step 6: Generating Prisma client..."
npx prisma generate --schema=prisma/schema.prisma > /dev/null

# Step 7: Clean and build
echo ""
echo "🧹 Step 7: Building application..."
rm -rf .next dist
npm run build

# Step 8: Start production server
echo ""
echo "🚀 Step 8: Starting production server..."
NEXTAUTH_URL="https://time.ranajakub.com" nohup npm run start > "$LOG_FILE" 2>&1 &
SERVER_PID=$!

# Step 9: Health check
echo ""
echo "⏳ Step 9: Health check..."
for i in {1..15}; do
    sleep 1
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/login" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo ""
        echo "════════════════════════════════════════"
        echo "✅ DEPLOYMENT SUCCESSFUL!"
        echo "════════════════════════════════════════"
        echo "   URL:  https://time.ranajakub.com"
        echo "   Port: $PORT"
        echo "   PID:  $SERVER_PID"
        echo "   Logs: tail -f $LOG_FILE"
        echo ""
        exit 0
    fi
    printf "   %d/15...\r" "$i"
done

echo ""
echo "════════════════════════════════════════"
echo "❌ DEPLOYMENT FAILED!"
echo "════════════════════════════════════════"
echo "Server did not respond within 15 seconds."
echo ""
echo "Recent logs:"
tail -30 "$LOG_FILE"
exit 1
