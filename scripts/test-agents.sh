#!/usr/bin/env bash
# test-agents.sh — Simulates 2 agents calling MCP tools against a running server.
# Each task sleeps 30s to give you time to watch the dashboard at http://localhost:51723
#
# Usage: bash scripts/test-agents.sh
#
# Prerequisites: the server must be running (pnpm dev:server or agent-checklist start)

set -euo pipefail

BASE="http://localhost:51723"
MCP="$BASE/mcp"
JSONRPC_ID=0

# ── helpers ────────────────────────────────────────────────────────────────

mcp_call() {
  # Send a JSON-RPC request to the MCP endpoint and return the result text.
  local method="$1"
  local params="$2"
  JSONRPC_ID=$((JSONRPC_ID + 1))
  local body
  body=$(printf '{"jsonrpc":"2.0","id":%d,"method":"%s","params":%s}' "$JSONRPC_ID" "$method" "$params")
  curl -s -X POST "$MCP" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "$body"
}

mcp_init() {
  # Initialize MCP session (required before tool calls for Streamable HTTP)
  JSONRPC_ID=$((JSONRPC_ID + 1))
  local body
  body=$(printf '{"jsonrpc":"2.0","id":%d,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test-script","version":"1.0.0"}}}' "$JSONRPC_ID")
  curl -s -X POST "$MCP" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d "$body" > /dev/null
}

call_tool() {
  local tool_name="$1"
  local arguments="$2"
  local params
  params=$(printf '{"name":"%s","arguments":%s}' "$tool_name" "$arguments")
  mcp_call "tools/call" "$params"
}

# ── check server ───────────────────────────────────────────────────────────

echo "Checking server at $BASE ..."
if ! curl -sf "$BASE/api/health" > /dev/null 2>&1; then
  echo "ERROR: Server not running. Start it first:"
  echo "  pnpm dev:server"
  echo "  # or: agent-checklist start"
  exit 1
fi
echo "Server is up."
echo ""

# ── clear board ────────────────────────────────────────────────────────────

echo "Clearing board ..."
curl -s -X POST "$BASE/api/board/clear" > /dev/null
echo "Board cleared."
echo ""

# ── agent IDs ──────────────────────────────────────────────────────────────

AGENT_A="test-agent-$(uuidgen | tr '[:upper:]' '[:lower:]')"
AGENT_B="test-agent-$(uuidgen | tr '[:upper:]' '[:lower:]')"

echo "Agent A: $AGENT_A"
echo "Agent B: $AGENT_B"
echo ""
echo "Open http://localhost:51723 to watch the dashboard."
echo "Each task takes ~30s. Total run time: ~3 minutes."
echo ""

# ── register agents ────────────────────────────────────────────────────────

echo "=== Registering Agent A: 'Build auth system' ==="
call_tool "register_agent" "$(printf '{"agentId":"%s","name":"Build auth system","tasks":["Design database schema","Implement JWT endpoints","Write integration tests"]}' "$AGENT_A")"
echo ""

echo "=== Registering Agent B: 'Setup CI pipeline' ==="
call_tool "register_agent" "$(printf '{"agentId":"%s","name":"Setup CI pipeline","tasks":["Configure GitHub Actions","Add linting step","Add deploy stage"]}' "$AGENT_B")"
echo ""

sleep 2

# ── helper: run one agent's tasks sequentially ─────────────────────────────

run_agent() {
  local agent_id="$1"
  local agent_name="$2"
  shift 2
  local task_ids=("$@")

  for i in "${!task_ids[@]}"; do
    local tid="${task_ids[$i]}"
    echo "[${agent_name}] Starting task: $tid"
    call_tool "update_task" "$(printf '{"agentId":"%s","taskId":"%s","status":"in_progress","note":"Working on it ..."}' "$agent_id" "$tid")" > /dev/null
    sleep 30
    echo "[${agent_name}] Completed task: $tid"
    call_tool "update_task" "$(printf '{"agentId":"%s","taskId":"%s","status":"completed","note":"Done"}' "$agent_id" "$tid")" > /dev/null
  done
  echo "[${agent_name}] All tasks done!"
}

# ── extract task IDs from board state ──────────────────────────────────────

echo "Fetching board state to get task IDs ..."
BOARD=$(curl -s "$BASE/api/state")

# Parse task IDs for each agent (uses python3 for reliable JSON parsing)
AGENT_A_TASKS=$(echo "$BOARD" | python3 -c "
import json, sys
board = json.load(sys.stdin)
agent = board.get('agents', {}).get('$AGENT_A', {})
print(' '.join(t['id'] for t in agent.get('tasks', [])))
")
AGENT_B_TASKS=$(echo "$BOARD" | python3 -c "
import json, sys
board = json.load(sys.stdin)
agent = board.get('agents', {}).get('$AGENT_B', {})
print(' '.join(t['id'] for t in agent.get('tasks', [])))
")

echo "Agent A tasks: $AGENT_A_TASKS"
echo "Agent B tasks: $AGENT_B_TASKS"
echo ""

# Convert to arrays
read -ra A_IDS <<< "$AGENT_A_TASKS"
read -ra B_IDS <<< "$AGENT_B_TASKS"

# ── run both agents in parallel ────────────────────────────────────────────

echo "=== Running both agents in parallel (30s per task) ==="
echo ""

run_agent "$AGENT_A" "Agent A" "${A_IDS[@]}" &
PID_A=$!

run_agent "$AGENT_B" "Agent B" "${B_IDS[@]}" &
PID_B=$!

wait $PID_A
wait $PID_B

echo ""
echo "=== All agents finished! ==="
echo "Check the dashboard at http://localhost:51723"
