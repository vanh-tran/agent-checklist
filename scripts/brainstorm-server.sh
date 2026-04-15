#!/usr/bin/env bash
# Starts the Superpowers brainstorming visual companion server.
# If a server is already alive for this project, prints its URL.
# Otherwise, starts a new one and prints the URL.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPERPOWERS_SCRIPT="/Users/vanhtran18/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/brainstorming/scripts/start-server.sh"
BRAINSTORM_DIR="$PROJECT_DIR/.superpowers/brainstorm"

if [[ ! -x "$SUPERPOWERS_SCRIPT" ]]; then
  echo "Error: superpowers brainstorming script not found at:" >&2
  echo "  $SUPERPOWERS_SCRIPT" >&2
  exit 1
fi

# Find the most recent session and check if its server is still alive
if [[ -d "$BRAINSTORM_DIR" ]]; then
  LATEST_SESSION="$(ls -1dt "$BRAINSTORM_DIR"/*/ 2>/dev/null | head -n1 || true)"
  if [[ -n "$LATEST_SESSION" ]]; then
    STATE_DIR="${LATEST_SESSION}state"
    INFO_FILE="$STATE_DIR/server-info"
    STOPPED_FILE="$STATE_DIR/server-stopped"
    if [[ -f "$INFO_FILE" && ! -f "$STOPPED_FILE" ]]; then
      # Check if the PID is still alive
      PID="$(grep -o '"pid":[0-9]*' "$INFO_FILE" 2>/dev/null | cut -d: -f2 || true)"
      if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
        echo "Brainstorm server already running:"
        cat "$INFO_FILE"
        exit 0
      fi
    fi
  fi
fi

# Start a fresh server
echo "Starting brainstorm server for $PROJECT_DIR"
exec "$SUPERPOWERS_SCRIPT" --project-dir "$PROJECT_DIR"
