#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$PROJECT_DIR/results"
TIMESTAMP=$(date '+%Y%m%d-%H%M%S')

echo "======================================"
echo " Compatibility Test Suite"
echo " $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "======================================"

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_ERR=0

run_suite() {
  local name="$1" script="$2" output_suffix="$3"
  local output_file="$RESULTS_DIR/${output_suffix}-${TIMESTAMP}.json"

  echo ""
  echo "--- $name ---"

  if ! node --no-warnings "$script" > "$output_file" 2>/dev/null; then
    echo "  [ERROR] Test script failed to execute"
    return 1
  fi

  if ! command -v jq >/dev/null 2>&1; then
    echo "  Results written to $output_file"
    return 0
  fi

  local total passed failed errors
  total=$(jq '.summary.total' "$output_file")
  passed=$(jq '.summary.passed' "$output_file")
  failed=$(jq '.summary.failed' "$output_file")
  errors=$(jq '.summary.errors' "$output_file")

  TOTAL_PASS=$((TOTAL_PASS + passed))
  TOTAL_FAIL=$((TOTAL_FAIL + failed))
  TOTAL_ERR=$((TOTAL_ERR + errors))

  echo "  $total tests: $passed pass, $failed fail, $errors error"

  if [ "$failed" -gt 0 ] || [ "$errors" -gt 0 ]; then
    jq -r '.results[] | select(.status == "fail" or .status == "error") | "  [\(.status | ascii_upcase)] \(.test_id): \(.name)"' "$output_file"
  fi

  echo "  → $output_file"
}

mkdir -p "$RESULTS_DIR"

run_suite "JavaScript Features (ES2020–ES2024)" \
  "$SCRIPT_DIR/javascript-features/feature-detect.js" \
  "js-features"

run_suite "Runtime Error Handling" \
  "$SCRIPT_DIR/runtime-errors/error-handling.js" \
  "runtime-errors"

run_suite "Isolation & Sandbox Detection" \
  "$SCRIPT_DIR/isolation/sandbox-detect.js" \
  "isolation"

GRAND_TOTAL=$((TOTAL_PASS + TOTAL_FAIL + TOTAL_ERR))

echo ""
echo "======================================"
echo " Grand Total: $GRAND_TOTAL tests"
echo "   Passed:  $TOTAL_PASS"
echo "   Failed:  $TOTAL_FAIL"
echo "   Errors:  $TOTAL_ERR"
echo "======================================"
echo ""
echo " All results in: $RESULTS_DIR/"
echo " Summarize with: scripts/summarize-results"
echo ""
echo " NOTE: Isolation tests report browser-only APIs as 'fail' in Node.js."
echo "       Run in a browser context for meaningful sandbox results."
echo "======================================"

if [ "$TOTAL_ERR" -gt 0 ]; then
  exit 1
fi
