#!/bin/bash

# Check if dev server is already running
if lsof -i :3002 > /dev/null 2>&1; then
    echo "════════════════════════════════════════════════════════════════"
    echo "⚠️  Dev server is ALREADY RUNNING on port 3002!"
    echo "════════════════════════════════════════════════════════════════"
    echo ""
    echo "Hot reload is active - just save your files and refresh browser."
    echo "NO NEED TO RESTART for code changes."
    echo ""
    echo "Only restart if:"
    echo "  - Server crashed"
    echo "  - Changed package.json or .env"
    echo "  - Port not responding"
    echo ""
    echo "To force restart: pkill -f 'tsx server' && npm run dev"
    echo "════════════════════════════════════════════════════════════════"
    exit 0
fi

# Not running, start it
echo "🚀 Starting dev server on port 3002..."
echo "   URL: https://dev.time.ranajakub.com"
echo ""
exec npm run dev

