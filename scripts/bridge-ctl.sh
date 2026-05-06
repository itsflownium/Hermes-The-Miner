#!/bin/bash
#
# bridge-ctl.sh - Control the Hermes Bridge from Hermes CLI
# Usage: bridge-ctl.sh <command> [args]
#
# Commands:
#   start              - Start bridge server in background
#   stop               - Stop bridge server
#   status             - Check if bridge is running
#   connect <host> <port> [version] - Connect Hermes to server
#   disconnect         - Disconnect bot
#   agent-start        - Start autonomous AI loop
#   agent-stop         - Stop autonomous AI loop
#   agent-status       - Get agent status
#   mode [MODE]        - Get or set behavior mode
#   goal [TEXT]        - Get or set the current goal
#   goal clear         - Clear the current goal
#   memory             - Show persistent Hermes memory
#   action <type> [json-params] - Send action to bot
#   perceive           - Get world snapshot
#   model              - Get current AI model
#   chat <message>     - Send chat as bot
#   log                - Show recent bridge log
#

API="http://localhost:3847"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$PROJECT_DIR/.bridge.pid"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

cmd="$1"
shift || true

case "$cmd" in
  start)
    # Check if already running
    if [ -f "$PIDFILE" ]; then
      OLD_PID=$(cat "$PIDFILE")
      if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "{\"success\":true,\"message\":\"Bridge already running on PID $OLD_PID\",\"running\":true}"
        exit 0
      fi
    fi
    # Kill any stale processes
    lsof -ti:3847 -ti:3848 2>/dev/null | xargs kill -9 2>/dev/null || true
    sleep 1
    # Check deps
    if [ ! -d "$PROJECT_DIR/node_modules" ]; then
      cd "$PROJECT_DIR" && npm install >/dev/null 2>&1
    fi
    # Build compiled bridge for a more stable daemon startup
    cd "$PROJECT_DIR"
    npm run build >/dev/null 2>&1 || {
      echo "{\"success\":false,\"message\":\"Bridge build failed. Check bridge.log\",\"running\":false}"
      exit 1
    }
    # Start bridge
    nohup node dist/index.js > "$PROJECT_DIR/bridge.log" 2>&1 &
    PID=$!
    echo $PID > "$PIDFILE"
    # Wait for it to be ready
    for i in {1..30}; do
      if curl -s "$API/health" >/dev/null 2>&1; then
        echo "{\"success\":true,\"message\":\"Bridge started on PID $PID\",\"running\":true}"
        exit 0
      fi
      sleep 1
    done
    echo "{\"success\":false,\"message\":\"Bridge failed to start. Check bridge.log\",\"running\":false}"
    ;;

  stop)
    if [ -f "$PIDFILE" ]; then
      PID=$(cat "$PIDFILE")
      kill "$PID" 2>/dev/null || true
      rm -f "$PIDFILE"
    fi
    lsof -ti:3847 -ti:3848 2>/dev/null | xargs kill -9 2>/dev/null || true
    echo "{\"success\":true,\"message\":\"Bridge stopped\",\"running\":false}"
    ;;

  status)
    if curl -s "$API/health" >/dev/null 2>&1; then
      curl -s "$API/health"
    else
      echo "{\"connected\":false,\"uptime\":0,\"agentRunning\":false,\"running\":false}"
    fi
    ;;

  connect)
    HOST="${1:-localhost}"
    PORT="${2:-25565}"
    VERSION="${3:-}"
    BODY="{\"host\":\"$HOST\",\"port\":$PORT,\"username\":\"Hermes\",\"auth\":\"offline\""
    [ -n "$VERSION" ] && BODY="$BODY,\"version\":\"$VERSION\""
    BODY="$BODY}"
    curl -s -X POST "$API/connect" -H "Content-Type: application/json" -d "$BODY"
    ;;

  disconnect)
    curl -s -X POST "$API/disconnect"
    ;;

  agent-start)
    curl -s -X POST "$API/agent/start"
    ;;

  agent-stop)
    curl -s -X POST "$API/agent/stop"
    ;;

  agent-status)
    curl -s "$API/agent/status"
    ;;

  mode)
    if [ -n "${1:-}" ]; then
      curl -s -X POST "$API/agent/mode" -H "Content-Type: application/json" -d "{\"mode\":\"${1}\"}"
    else
      curl -s "$API/agent/mode"
    fi
    ;;

  goal)
    if [ "${1:-}" = "clear" ]; then
      curl -s -X DELETE "$API/agent/goal"
    elif [ -n "${1:-}" ]; then
      MSG="$*"
      curl -s -X POST "$API/agent/goal" -H "Content-Type: application/json" -d "{\"summary\":\"$MSG\",\"kind\":\"general\"}"
    else
      curl -s "$API/agent/goal"
    fi
    ;;

  memory)
    curl -s "$API/memory"
    ;;

  action)
    TYPE="$1"
    shift || true
    PARAMS="$*"
    # Use Python for reliable JSON construction
    python3 -c "
import json, sys
type_name = '$TYPE'
params_str = '''$PARAMS'''
# Remove outer quotes if present
params_str = params_str.strip().strip(\"'\").strip('\"')
body = {'type': type_name}
if params_str:
    try:
        params = json.loads('{' + params_str + '}')
        body.update(params)
    except:
        # Try parsing as full JSON object
        try:
            params = json.loads(params_str)
            if isinstance(params, dict):
                body.update(params)
        except:
            pass
print(json.dumps(body))
" | curl -s -X POST "$API/action" -H "Content-Type: application/json" -d @-
    ;;

  perceive)
    curl -s "$API/perceive"
    ;;

  model)
    curl -s "$API/model"
    ;;

  chat)
    MSG="$*"
    curl -s -X POST "$API/action" -H "Content-Type: application/json" -d "{\"type\":\"say\",\"message\":\"$MSG\"}"
    ;;

  log)
    if [ -f "$PROJECT_DIR/bridge.log" ]; then
      tail -50 "$PROJECT_DIR/bridge.log"
    else
      echo "No log file found"
    fi
    ;;

  *)
    echo "Usage: bridge-ctl.sh <command>"
    echo ""
    echo "Commands:"
    echo "  start                          - Start bridge server"
    echo "  stop                           - Stop bridge server"
    echo "  status                         - Check bridge status"
    echo "  connect <host> <port> [version] - Connect Hermes to server"
    echo "  disconnect                     - Disconnect bot"
    echo "  agent-start                    - Start AI agent"
    echo "  agent-stop                     - Stop AI agent"
    echo "  agent-status                   - Get agent status"
    echo "  mode [MODE]                    - Get or set behavior mode"
    echo "  goal [TEXT]                    - Get or set current goal"
    echo "  goal clear                     - Clear current goal"
    echo "  memory                         - Show persistent Hermes memory"
    echo "  action <type> [params]         - Send action"
    echo "  perceive                       - Get world snapshot"
    echo "  model                          - Get current AI model"
    echo "  chat <message>                 - Send chat as bot"
    echo "  log                            - Show bridge log"
    ;;
esac
