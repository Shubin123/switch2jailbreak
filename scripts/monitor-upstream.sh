#!/usr/bin/env bash
set -euo pipefail

INTERVAL_MINUTES="${1:-30}"
INTERVAL_SECONDS=$((INTERVAL_MINUTES * 60))
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "======================================"
echo " ns2jb Upstream Monitor"
echo " Interval: every ${INTERVAL_MINUTES} minute(s)"
echo " Press Ctrl+C to stop"
echo "======================================"

while true; do
  echo ""
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running upstream check..."
  "${SCRIPT_DIR}/check-upstream.sh" || echo "  [ERROR] Check failed."
  
  echo ""
  echo "Sleeping for ${INTERVAL_MINUTES} minute(s)... (Press Ctrl+C to cancel)"
  sleep "$INTERVAL_SECONDS"
done
