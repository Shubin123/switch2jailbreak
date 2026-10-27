#!/usr/bin/env bash
set -euo pipefail

echo "======================================"
echo " macOS Environment Check for ns2jb"
echo "======================================"

PASS=0
FAIL=0

check_cmd() {
  local name="$1"
  local cmd="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    local ver
    ver=$("$cmd" --version 2>&1 | head -n 1)
    echo "  [OK] $name: $ver"
    PASS=$((PASS + 1))
  else
    echo "  [MISSING] $name is not installed"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "--- Core Tools ---"

# Check Node.js >= 22
if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node --version | sed 's/^v//')
  NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 22 ]; then
    echo "  [OK] Node.js: v$NODE_VER (>= 22.0.0 requirement met)"
    PASS=$((PASS + 1))
  else
    echo "  [WARN] Node.js: v$NODE_VER (Node.js 22+ recommended for upstream tooling)"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  [MISSING] Node.js is not installed (Node.js 22+ required)"
  FAIL=$((FAIL + 1))
fi

check_cmd "curl" "curl"
check_cmd "git" "git"

# jq (optional)
if command -v jq >/dev/null 2>&1; then
  JQ_VER=$(jq --version 2>&1 | head -n 1)
  echo "  [OK] jq (optional): $JQ_VER"
else
  echo "  [INFO] jq is not installed (optional, used for formatting API JSON)"
fi

echo ""
echo "--- Network & Interfaces ---"

# Detect IP addresses
FOUND_IP=0
for iface in en0 en1 en2 en3; do
  if IP=$(ipconfig getifaddr "$iface" 2>/dev/null); then
    echo "  [IP] Interface $iface: $IP"
    FOUND_IP=1
  fi
done

if [ "$FOUND_IP" -eq 0 ]; then
  echo "  [WARN] No active local IP address detected on en0-en3."
fi

# Firewall check
echo ""
echo "--- Firewall Status ---"
if [ -f /usr/libexec/ApplicationFirewall/socketfilterfw ]; then
  FW_STATE=$(/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>&1 || true)
  echo "  macOS Firewall state: $FW_STATE"
fi

echo ""
echo "======================================"
echo " Summary: $PASS passed, $FAIL failed"
echo "======================================"
