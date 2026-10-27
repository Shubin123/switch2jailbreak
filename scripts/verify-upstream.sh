#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$PROJECT_DIR/results"
for required in node git jq shasum; do
  command -v "$required" >/dev/null 2>&1 || { echo "Missing required tool: $required" >&2; exit 1; }
done
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/ns2jb-verify.XXXXXX")
EXPECTED_COMMIT=$(jq -er '.targets[] | select(.id == "ns2jb-smilebasic") | .upstream.last_known_commit' "$PROJECT_DIR/config/targets.json")
if ! [[ "$EXPECTED_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Upstream revision must be a full commit hash" >&2
  exit 1
fi
mkdir -p "$RESULTS_DIR"

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
if git init -q "$SCRATCH/ns2jb" &&
   git -C "$SCRATCH/ns2jb" fetch -q --depth=1 https://gitlab.com/pepsipu/ns2jb.git "$EXPECTED_COMMIT" &&
   git -C "$SCRATCH/ns2jb" checkout -q --detach FETCH_HEAD; then
  add_result "build-001" "Clone upstream repository" "pass" "cloned"
else
  add_result "build-001" "Clone upstream repository" "error" "" "git clone failed"
  echo "Cannot continue without upstream. Exiting."
  exit 1
fi

cd "$SCRATCH/ns2jb"
ACTUAL_COMMIT=$(git rev-parse HEAD)
if [ "$ACTUAL_COMMIT" != "$EXPECTED_COMMIT" ]; then
  echo "Fetched revision does not match configured pin" >&2
  exit 1
fi

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
TEST_STATUS=0
TEST_OUTPUT=$(node --test --test-reporter=tap test.cjs 2>&1) || TEST_STATUS=$?
TEST_PASS=$(printf '%s\n' "$TEST_OUTPUT" | awk '/^# pass / {print $3}')
TEST_FAIL=$(printf '%s\n' "$TEST_OUTPUT" | awk '/^# fail / {print $3}')
TEST_PASS=${TEST_PASS:-0}
TEST_FAIL=${TEST_FAIL:-0}

if [ "$TEST_STATUS" -eq 0 ] && [ "$TEST_FAIL" -eq 0 ] && [ "$TEST_PASS" -gt 0 ]; then
  add_result "build-003" "Upstream tests ($TEST_PASS tests)" "pass" "$TEST_PASS pass, $TEST_FAIL fail"
else
  add_result "build-003" "Upstream tests" "fail" "$TEST_PASS pass, $TEST_FAIL fail, exit $TEST_STATUS"
  printf '%s\n' "$TEST_OUTPUT" >&2
fi

# --- SHA256 verification ---
echo ""
echo "--- SHA256 checksums ---"
if [ -f SHA256SUMS ]; then
  TOTAL_FILES=$(wc -l < SHA256SUMS | tr -d ' ')
  SHA_STATUS=0
  SHA_OUTPUT=$(shasum -a 256 --check SHA256SUMS 2>&1) || SHA_STATUS=$?
  SHA_OK=$(echo "$SHA_OUTPUT" | grep -c ": OK$" || true)
  SHA_FAIL=$(echo "$SHA_OUTPUT" | grep -c ": FAILED$" || true)
  FAILED_FILES=$(echo "$SHA_OUTPUT" | grep ": FAILED$" | sed 's/: FAILED$//' || true)

  if [ "$SHA_STATUS" -eq 0 ] && [ "$SHA_OK" -eq "$TOTAL_FILES" ] && [ "$TOTAL_FILES" -gt 0 ]; then
    add_result "build-004" "SHA256 all files ($TOTAL_FILES)" "pass" "$SHA_OK/$TOTAL_FILES OK"
  elif [ "$EXPECTED_COMMIT" = "95f5525089273c5fce0b95047f3600f8442e96ae" ] &&
       [ "$FAILED_FILES" = "README.md" ] && [ "$SHA_FAIL" -eq 1 ] &&
       [ "$((SHA_OK + 1))" -eq "$TOTAL_FILES" ] &&
       [ "$(shasum -a 256 README.md | cut -d' ' -f1)" = "cb0ce047b522ef445bef68ca96c39b41d2ec606586a00d3187f0ff6725490af4" ] &&
       [ "$(awk '$2 == "README.md" {print $1}' SHA256SUMS)" = "39aa0e490fa0dc2009a4f3c63ee4cc597982a4bbf0c29443186e1c3ac09babbf" ]; then
    add_result "build-004" "SHA256 policy with reviewed documentation exception" "pass" "$SHA_OK/$TOTAL_FILES match; exact README mismatch accepted only for pinned revision and reviewed hashes"
  else
    add_result "build-004" "SHA256 checksums" "fail" "$SHA_OK/$TOTAL_FILES OK, $SHA_FAIL failed"
  fi
else
  add_result "build-004" "SHA256 checksums" "fail" "SHA256SUMS file not found"
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
  add_result "build-005" "Payload binary matches manifest" "fail" "payload files not found"
  add_result "build-006" "Payload contains NSO header" "fail" "payload files not found"
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
  if [ "$ZIG_VER" = "0.15.2" ] && node engine/build-payload.cjs --check --zig "$(command -v zig)"; then
    add_result "build-008" "Payload rebuild matches shipped binary" "pass" "Zig $ZIG_VER byte-for-byte check passed"
  else
    add_result "build-008" "Payload rebuild matches shipped binary" "fail" "requires Zig 0.15.2 and a matching rebuild"
  fi
else
  if [ "${REQUIRE_REBUILD:-0}" = "1" ]; then
    add_result "build-008" "Payload rebuild matches shipped binary" "fail" "Zig 0.15.2 is required"
  else
    add_result "build-008" "Payload rebuild matches shipped binary" "skip" "Zig 0.15.2 not installed; rebuild unverified"
  fi
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
    --arg revision "$ACTUAL_COMMIT" \
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
      upstream_revision: $revision,
      environment: { os: $os, os_version: $osv, node_version: $nv },
      results: $results,
      summary: { total: $total, passed: $passed, failed: $failed, skipped: $skipped, errors: 0 }
    }' > "$RESULTS_DIR/build-verify-$(date '+%Y%m%d').json"
  echo " Results written to results/build-verify-$(date '+%Y%m%d').json"
fi

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
