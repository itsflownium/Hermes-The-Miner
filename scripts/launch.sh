#!/bin/bash
#
# Hermes The Miner - One-Click Launcher
# Usage: ./scripts/launch.sh
#

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${BRIDGE_API_PORT:-3847}"
WS_PORT="${BRIDGE_WS_PORT:-3848}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

print_banner() {
    echo ""
    echo "  ${CYAN}╔════════════════════════════════════════════════════════════════════╗${NC}"
    echo "  ${CYAN}║                                                                    ║${NC}"
    echo "  ${CYAN}║  ${WHITE}Hermes The Miner${NC}                                      ${CYAN}║${NC}"
    echo "  ${CYAN}║  ${WHITE}Autonomous AI Companion${NC}                                 ${CYAN}║${NC}"
    echo "  ${CYAN}║                                                                    ║${NC}"
    echo "  ${CYAN}╚════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Step 0: Kill old bridge processes
echo "${CYAN}[1/4] Cleaning up old processes...${NC}"
lsof -ti:"$API_PORT" -ti:"$WS_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# Step 1: Check prerequisites
echo "${CYAN}[2/4] Checking prerequisites...${NC}"

MISSING=()

if ! command -v node &>/dev/null; then
    MISSING+=("Node.js")
fi

if ! command -v hermes &>/dev/null; then
    MISSING+=("Hermes CLI")
fi

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
    echo "  ${YELLOW}!${NC} node_modules missing — installing now..."
    cd "$PROJECT_DIR"
    npm install
fi

if [ ${#MISSING[@]} -gt 0 ]; then
    echo "  ${RED}✗${NC} Missing prerequisites: ${MISSING[*]}"
    echo ""
    echo "  Install Node.js: https://nodejs.org"
    echo "  Install Hermes CLI:"
    echo "    curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash"
    exit 1
fi

# Step 2: Check model config
echo "${CYAN}[3/4] Checking AI model config...${NC}"
if command -v hermes &>/dev/null; then
    MODEL=$(hermes config get model.default 2>/dev/null || echo "")
    PROVIDER=$(hermes config get model.provider 2>/dev/null || echo "")
    if [ -n "$MODEL" ]; then
        echo "  ${GREEN}✓${NC} Model: $MODEL (provider: $PROVIDER)"
    else
        echo "  ${YELLOW}!${NC} No model configured. Run: hermes model"
    fi
fi

# Step 3: Start the bridge in background
echo "${CYAN}[4/4] Starting bridge server...${NC}"
cd "$PROJECT_DIR"
nohup npm run start > "$PROJECT_DIR/bridge.log" 2>&1 &
BRIDGE_PID=$!
sleep 2

# Wait for bridge to come online
echo "  Waiting for bridge to start..."
for i in {1..30}; do
    if curl -s "http://localhost:$API_PORT/health" > /dev/null 2>&1; then
        break
    fi
    sleep 1
done

if ! curl -s "http://localhost:$API_PORT/health" > /dev/null 2>&1; then
    echo "  ${RED}✗${NC} Bridge failed to start. Check bridge.log"
    echo ""
    tail -20 "$PROJECT_DIR/bridge.log"
    exit 1
fi

echo "  ${GREEN}✓${NC} Bridge running on PID $BRIDGE_PID"
echo ""

# Show summary
print_banner

echo "  ${WHITE}Bridge Status: ${GREEN}Online${NC}"
echo "  ${WHITE}API:${NC}   http://localhost:$API_PORT"
echo "  ${WHITE}WS:${NC}    ws://localhost:$WS_PORT"
echo ""
echo "  ${CYAN}━━ Quick Actions ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  ${WHITE}Open Dashboard:${NC}     open http://localhost:$API_PORT"
echo "  ${WHITE}Stop Bridge:${NC}       kill $BRIDGE_PID"
echo ""
echo "  ${CYAN}━━ In Hermes CLI ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  ${WHITE}hermes -s hermes-minecraft-agent${NC}"
echo ""
echo "  Then say: \"Connect to Minecraft server at localhost:25565\""
echo "  Or:       \"Start the Minecraft agent\""
echo ""
# Open browser if on macOS
if command -v open &>/dev/null; then
    sleep 1
    open "http://localhost:$API_PORT" 2>/dev/null || true
fi

echo "  ${GREEN}Ready!${NC} Bridge log: $PROJECT_DIR/bridge.log"
echo ""

# Save PID for easy stop
echo $BRIDGE_PID > "$PROJECT_DIR/.bridge.pid"
