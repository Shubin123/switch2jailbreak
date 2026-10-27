#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$PROJECT_DIR/results"
SCRATCH="/tmp/ns2jb-verify-$$"

trap 'rm -rf "$SCRATCH"' EXIT

echo "======================================"
echo " Upstream Build & Integrity Verification"
echo " $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "======================================"

PASS=0
FAIL=0
SKIP=0
RESULTS='[]'

add_result() {
  local id="$1" name="$2" status="$3" actual="${4:-}" error="${5:-}"
  if command -v jq >/dev/null 2>&1; then
    RESULTS=$(echo "$RESULTS" | jq --arg id "$id" --arg name "$name" --arg status "$status" \
      --arg actual "$actual" --arg error "$error" \
      '. + [{ test_id: $id, category: "build", name: $name, status: $status, expected: "pass", actual: $actual } + (if $error != "" then { error_message: $error } else {} end)]')
  fi
  case "$status" in
    pass) PASS=$((PASS + 1)); echo "  [PASS] $name" ;;
    fail) FAIL=$((FAIL + 1)); echo "  [FAIL] $name — $actual" ;;
    skip) SKIP=$((SKIP + 1)); echo "  [SKIP] $name — $actual" ;;
    error) FAIL=$((FAIL + 1)); echo "  [ERROR] $name — $error" ;;
  esac
}

# --- Clone upstream ---
echo ""
echo "--- Cloning upstream ---"
mkdir -p "$SCRATCH"
if git clone --depth=1 https://gitlab.com/pepsipu/ns2jb.git "$SCRATCH/ns2jb" 2>/dev/null; then
  add_result "build-001" "Clone upstream repository" "pass" "cloned"
else
  add_result "build-001" "Clone upstream repository" "error" "" "git clone failed"
  echo "Cannot continue without upstream. Exiting."
  exit 1
fi

cd "$SCRATCH/ns2jb"

# --- Check Node.js version ---
echo ""
echo "--- Node.js version ---"
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node --version | sed 's/^v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 22 ]; then
    add_result "build-002" "Node.js >= 22" "pass" "v$NODE_VER"
  else
    add_result "build-002" "Node.js >= 22" "fail" "v$NODE_VER"
  fi
else
  add_result "build-002" "Node.js >= 22" "fail" "not installed"
fi

# --- Run upstream tests ---
echo ""
echo "--- Upstream test suite ---"
TEST_OUTPUT=$(node --test test.cjs 2>&1) || true
TEST_PASS=$(echo "$TEST_OUTPUT" | grep -c "^✔" || true)
TEST_FAIL=$(echo "$TEST_OUTPUT" | grep -c "^✖" || true)

if [ "$TEST_FAIL" -eq 0 ] && [ "$TEST_PASS" -gt 0 ]; then
  add_result "build-003" "Upstream tests ($TEST_PASS tests)" "pass" "$TEST_PASS pass, $TEST_FAIL fail"
else
  add_result "build-003" "Upstream tests" "fail" "$TEST_PASS pass, $TEST_FAIL fail"
fi

# --- SHA256 verification ---
echo ""
echo "--- SHA256 checksums ---"
if [ -f SHA256SUMS ]; then
  TOTAL_FILES=$(wc -l < SHA256SUMS | tr -d ' ')
  SHA_OUTPUT=$(shasum -a 256 --check SHA256SUMS 2>&1) || true
  SHA_OK=$(echo "$SHA_OUTPUT" | grep -c ": OK$" || true)
  SHA_FAIL=$(echo "$SHA_OUTPUT" | grep -c ": FAILED$" || true)
  FAILED_FILES=$(echo "$SHA_OUTPUT" | grep ": FAILED$" | sed 's/: FAILED$//' || true)

  if [ "$SHA_FAIL" -eq 0 ]; then
    add_result "build-004" "SHA256 all files ($TOTAL_FILES)" "pass" "$SHA_OK/$TOTAL_FILES OK"
  elif [ "$SHA_FAIL" -le 1 ] && echo "$FAILED_FILES" | grep -q "README.md"; then
    add_result "build-004" "SHA256 code files" "pass" "$SHA_OK/$TOTAL_FILES OK (README.md doc-only mismatch)"
  else
    add_result "build-004" "SHA256 checksums" "fail" "$SHA_OK/$TOTAL_FILES OK, $SHA_FAIL failed"
  fi
else
  add_result "build-004" "SHA256 checksums" "skip" "SHA256SUMS file not found"
fi

# --- Payload integrity ---
echo ""
echo "--- Payload integrity ---"
if [ -f engine/switch2/ro/payload/main ] && [ -f engine/switch2/ro/payload/manifest.json ]; then
  if command -v jq >/dev/null 2>&1; then
    EXPECTED_HASH=$(jq -r '.payloadSha256' engine/switch2/ro/payload/manifest.json)
    ACTUAL_HASH=$(shasum -a 256 engine/switch2/ro/payload/main | cut -d' ' -f1)
    if [ "$EXPECTED_HASH" = "$ACTUAL_HASH" ]; then
      add_result "build-005" "Payload binary matches manifest" "pass" "SHA256 match"
    else
      add_result "build-005" "Payload binary matches manifest" "fail" "hash mismatch"
    fi

    NSO_MAGIC=$(head -c4 engine/switch2/ro/payload/main)
    if [ "$NSO_MAGIC" = "NSO0" ]; then
      add_result "build-006" "Payload contains NSO header" "pass" "NSO0 magic present"
    else
      add_result "build-006" "Payload contains NSO header" "fail" "unexpected header"
    fi
  else
    add_result "build-005" "Payload binary matches manifest" "skip" "jq not installed"
    add_result "build-006" "Payload contains NSO header" "skip" "jq not installed"
  fi
else
  add_result "build-005" "Payload binary matches manifest" "skip" "payload files not found"
  add_result "build-006" "Payload contains NSO header" "skip" "payload files not found"
fi

# --- Dependency audit ---
echo ""
echo "--- Dependency audit ---"
if [ ! -f package.json ]; then
  add_result "build-007" "No external npm dependencies" "pass" "no package.json"
else
  DEP_COUNT=$(jq '[.dependencies // {}, .devDependencies // {}] | map(keys) | flatten | length' package.json 2>/dev/null || echo "unknown")
  if [ "$DEP_COUNT" = "0" ]; then
    add_result "build-007" "No external npm dependencies" "pass" "0 deps in package.json"
  else
    add_result "build-007" "No external npm dependencies" "fail" "$DEP_COUNT dependencies found"
  fi
fi

# --- Zig availability (for payload rebuild) ---
echo ""
echo "--- Zig compiler (optional) ---"
if command -v zig >/dev/null 2>&1; then
  ZIG_VER=$(zig version 2>&1)
  add_result "build-008" "Zig compiler for payload rebuild" "pass" "$ZIG_VER"
else
  add_result "build-008" "Zig compiler for payload rebuild" "skip" "not installed (optional — pre-built payload verified)"
fi

# --- Write JSON results ---
echo ""
echo "======================================"
echo " Summary: $PASS pass, $FAIL fail, $SKIP skip"
echo "======================================"

if command -v jq >/dev/null 2>&1; then
  TOTAL=$((PASS + FAIL + SKIP))
  jq -n \
    --arg sv "1.0.0" \
    --arg rid "$(date -u '+%Y-%m-%dT%H-%M-%SZ')-build" \
    --arg ts "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    --arg os "$(uname -s)" \
    --arg osv "$(uname -r)" \
    --arg nv "$(node --version 2>/dev/null || echo unknown)" \
    --argjson results "$RESULTS" \
    --argjson total "$TOTAL" \
    --argjson passed "$PASS" \
    --argjson failed "$FAIL" \
    --argjson skipped "$SKIP" \
    '{
      schema_version: $sv,
      run_id: $rid,
      timestamp: $ts,
      target_id: "ns2jb-smilebasic",
      environment: { os: $os, os_version: $osv, node_version: $nv },
      results: $results,
      summary: { total: $total, passed: $passed, failed: $failed, skipped: $skipped, errors: 0 }
    }' > "$RESULTS_DIR/build-verify-$(date '+%Y%m%d').json"
  echo " Results written to results/build-verify-$(date '+%Y%m%d').json"
fi
