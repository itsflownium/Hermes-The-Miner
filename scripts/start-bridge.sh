#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Kill any existing bridge processes on our ports
echo "[INFO] Cleaning up old bridge processes..."
lsof -ti:3847 -ti:3848 | xargs kill -9 2>/dev/null || true
sleep 1

# Check deps
if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    echo "[WARN] node_modules missing. Running setup first..."
    cd "$PROJECT_DIR"
    ./scripts/setup.sh
fi

echo ""
echo "  ╭ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ╮"
echo "  │  Hermes the Miner — Bridge Server                            │"
echo "  ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤"
echo "  │  REST API:  http://localhost:${BRIDGE_API_PORT:-3847}        │"
echo "  │  WebSocket: ws://localhost:${BRIDGE_WS_PORT:-3848}         │"
echo "  │  Dashboard: http://localhost:${BRIDGE_API_PORT:-3847}        │"
echo "  ╰ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ╯"
echo ""
echo "  Press Ctrl+C to stop"
echo ""

cd "$PROJECT_DIR"
npm run start
