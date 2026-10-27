#!/usr/bin/env bash
set -euo pipefail

GITLAB_API="https://gitlab.com/api/v4/projects/pepsipu%2Fns2jb/repository/commits/main"
GITLAB_RAW_README="https://gitlab.com/pepsipu/ns2jb/-/raw/main/README.md"

echo "======================================"
echo " Checking Upstream ns2jb Repository"
echo " Target: gitlab.com/pepsipu/ns2jb"
echo "======================================"

echo ""
echo "Fetching latest commit metadata from GitLab API..."
COMMIT_JSON=$(curl -s --fail --location "$GITLAB_API" 2>/dev/null || echo "")

if [ -n "$COMMIT_JSON" ]; then
  if command -v jq >/dev/null 2>&1; then
    COMMIT_ID=$(echo "$COMMIT_JSON" | jq -r '.id // empty' | cut -c1-8)
    COMMIT_TITLE=$(echo "$COMMIT_JSON" | jq -r '.title // empty')
    COMMIT_DATE=$(echo "$COMMIT_JSON" | jq -r '.created_at // empty')
    echo "  Latest commit:  $COMMIT_ID"
    echo "  Committed at:   $COMMIT_DATE"
    echo "  Message:        $COMMIT_TITLE"
  else
    echo "  Commit metadata received (install 'jq' for parsed output)."
    echo "  Raw summary: $(echo "$COMMIT_JSON" | tr -d '\n' | cut -c1-120)..."
  fi
else
  echo "  [WARN] Could not retrieve commit metadata from GitLab API."
fi

echo ""
echo "Checking README for WebKit / browser entry point references..."
README_CONTENT=$(curl -s --fail --location "$GITLAB_RAW_README" 2>/dev/null || echo "")

if [ -n "$README_CONTENT" ]; then
  if echo "$README_CONTENT" | grep -iq "webkit\|browser"; then
    echo "  [NOTICE] WebKit/browser references found in upstream README!"
    echo "$README_CONTENT" | grep -in -C 2 -E "webkit|browser"
  else
    echo "  [STATUS] No WebKit/browser entry point documented in upstream README yet."
    echo "           Upstream still specifies SmileBASIC requirements."
  fi
else
  echo "  [WARN] Could not retrieve upstream README."
fi

echo ""
echo "======================================"
