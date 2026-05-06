#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "  ╦ ╦╔═╗╦═╗╦  ╔═╗╔═╗╔╦╗╦╔╗╔╔═╗  ╔╗ ╦ ╦╔═╗╦═╗╔═╗"
echo "  ╠═╣╠═╣╠╦╝║  ║ ║╠═╝ ║ ║║║║║ ║  ╠╩╗╚╦╝║╣ ╠╦╝║╣ "
echo "  ╩ ╩╩ ╩╩╚═╩═╝╚═╝╩   ╩ ╩╝╚╝╚═╝  ╚═╝ ╩ ╚═╝╩╚═╚═╝"
echo ""
echo "  Setup"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
    echo "[ERROR] Node.js is required. Install from https://nodejs.org"
    exit 1
fi
echo "[OK] Node.js $(node --version)"

# Check npm
if ! command -v npm &>/dev/null; then
    echo "[ERROR] npm is required (comes with Node.js)"
    exit 1
fi
echo "[OK] npm $(npm --version)"

# Check hermes CLI
if ! command -v hermes &>/dev/null; then
    echo "[WARN] hermes CLI not found. Install with:"
    echo "       curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash"
    echo ""
else
    echo "[OK] hermes CLI found"
fi

# Install bridge dependencies
echo ""
echo "[STEP] Installing bridge dependencies..."
cd "$PROJECT_DIR"
npm install
echo "[OK] Bridge dependencies installed"

# Check Hermes model config
echo ""
echo "[STEP] Checking Hermes model config..."
if command -v hermes &>/dev/null; then
    MODEL=$(hermes config get model.default 2>/dev/null || echo "")
    if [ -n "$MODEL" ]; then
        echo "[OK] Model configured: $MODEL"
    else
        echo "[WARN] No model configured. Run 'hermes model' to set one up."
    fi
else
    echo "[SKIP] hermes CLI not available"
fi

echo ""
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "    1. Start a Minecraft server (or use an Open-to-LAN world)"
echo "    2. Start the bridge:"
echo "       cd $PROJECT_DIR && ./scripts/start-bridge.sh"
echo "    3. Connect Hermes to your LAN port:"
echo "       ./scripts/bridge-ctl.sh connect localhost <LAN_PORT>"
echo "    4. Start the agent loop:"
echo "       ./scripts/bridge-ctl.sh agent-start"
echo ""
