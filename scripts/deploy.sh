#!/bin/bash
set -e

# Full deployment workflow:
# 1. Commit & push changes from dev directory
# 2. Pull latest in prod directory
# 3. Build & start production server

DEV_DIR="/root/trackify"
PROD_DIR="/root/trackify-prod"
PORT=3000
PROD_URL="https://trackify.ranajakub.com"
LOG_FILE="/tmp/trackify-prod.log"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
pm2 stop trackify-prod 2>/dev/null || true
sleep 2

# Step 4: Pull latest changes in prod directory
echo ""
echo "📥 Step 4: Pulling latest in production..."
cd "$PROD_DIR"
git fetch origin
git reset --hard origin/master
echo "   Updated to $(git rev-parse --short HEAD)"
bash "$SCRIPT_DIR/sync-production-env.sh" "$PROD_DIR"

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
bash "$SCRIPT_DIR/verify-production.sh" source
bash "$SCRIPT_DIR/write-build-info.sh" "$PROD_DIR"
rm -rf .next dist
npm run build
bash "$SCRIPT_DIR/verify-production.sh" compiled

# Step 8: Start production server from ecosystem config
echo ""
echo "🚀 Step 8: Starting production server..."
pm2 startOrReload "$PROD_DIR/ecosystem.config.cjs" --only trackify-prod --update-env
pm2 save
SERVER_PID=$(pm2 pid trackify-prod)

# Step 9: Verify PM2 cwd and runtime model
echo ""
echo "🔎 Step 9: Verifying production process..."
bash "$SCRIPT_DIR/verify-production.sh" pm2
bash "$SCRIPT_DIR/verify-production.sh" runtime
bash "$SCRIPT_DIR/verify-production.sh" auth
python3 "$SCRIPT_DIR/configure-caddy-production.py"
bash "$SCRIPT_DIR/verify-public-production.sh"

# Step 10: Health check
echo ""
echo "⏳ Step 10: Health check..."
for i in {1..15}; do
    sleep 1
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/login" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo ""
        echo "════════════════════════════════════════"
        echo "✅ DEPLOYMENT SUCCESSFUL!"
        echo "════════════════════════════════════════"
        echo "   URL:  $PROD_URL"
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
