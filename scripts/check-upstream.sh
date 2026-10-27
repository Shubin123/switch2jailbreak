#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$PROJECT_DIR/config/targets.json"
STATE_FILE="$PROJECT_DIR/.upstream-state.json"

GITLAB_API="https://gitlab.com/api/v4/projects/pepsipu%2Fns2jb"
GITLAB_COMMITS="$GITLAB_API/repository/commits/main"
GITLAB_BRANCHES="$GITLAB_API/repository/branches"
GITLAB_TAGS="$GITLAB_API/repository/tags"
GITLAB_RAW_README="https://gitlab.com/pepsipu/ns2jb/-/raw/main/README.md"

GIST_ID="c1a5a09ec5005e93cf86380260060dac"
GIST_API="https://api.github.com/gists/$GIST_ID"

BLOG_URL="https://pepsipu.com/blog/2026-10-switch2-jailbreak-ns2jb/"

CHANGES_DETECTED=0
REPORT=""
NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

log() { echo "  $1"; }
section() { echo ""; echo "--- $1 ---"; }
notice() { echo "  [NOTICE] $1"; CHANGES_DETECTED=1; REPORT="$REPORT\n- $1"; }
warn() { echo "  [WARN] $1"; }
ok() { echo "  [OK] $1"; }

load_state() {
  if [ -f "$STATE_FILE" ] && command -v jq >/dev/null 2>&1; then
    PREV_COMMIT=$(jq -r '.gitlab_commit // empty' "$STATE_FILE")
    PREV_GIST_UPDATED=$(jq -r '.gist_updated_at // empty' "$STATE_FILE")
    PREV_BRANCH_COUNT=$(jq -r '.gitlab_branch_count // empty' "$STATE_FILE")
    PREV_TAG_COUNT=$(jq -r '.gitlab_tag_count // empty' "$STATE_FILE")
  else
    PREV_COMMIT=""
    PREV_GIST_UPDATED=""
    PREV_BRANCH_COUNT=""
    PREV_TAG_COUNT=""
  fi
}

save_state() {
  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg gc "${CURRENT_COMMIT:-}" \
      --arg gu "${CURRENT_GIST_UPDATED:-}" \
      --arg bc "${CURRENT_BRANCH_COUNT:-}" \
      --arg tc "${CURRENT_TAG_COUNT:-}" \
      --arg ts "$NOW" \
      '{
        gitlab_commit: $gc,
        gist_updated_at: $gu,
        gitlab_branch_count: ($bc | if . == "" then null else tonumber end),
        gitlab_tag_count: ($tc | if . == "" then null else tonumber end),
        last_checked: $ts
      }' > "$STATE_FILE"
  fi
}

echo "======================================"
echo " ns2jb Upstream Verification"
echo " $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "======================================"

load_state

# --- 1. GitLab: latest commit ---
section "GitLab Repository (pepsipu/ns2jb)"

COMMIT_JSON=$(curl -s --fail --location --max-time 15 "$GITLAB_COMMITS" 2>/dev/null || echo "")

if [ -n "$COMMIT_JSON" ] && command -v jq >/dev/null 2>&1; then
  CURRENT_COMMIT=$(echo "$COMMIT_JSON" | jq -r '.id // empty' | cut -c1-8)
  COMMIT_TITLE=$(echo "$COMMIT_JSON" | jq -r '.title // empty')
  COMMIT_DATE=$(echo "$COMMIT_JSON" | jq -r '.created_at // empty')
  log "Latest commit:  $CURRENT_COMMIT"
  log "Date:           $COMMIT_DATE"
  log "Message:        $COMMIT_TITLE"

  if [ -n "$PREV_COMMIT" ] && [ "$PREV_COMMIT" != "$CURRENT_COMMIT" ]; then
    notice "New commit detected: $PREV_COMMIT → $CURRENT_COMMIT"
  elif [ -n "$PREV_COMMIT" ]; then
    ok "No new commits since last check."
  fi
elif [ -n "$COMMIT_JSON" ]; then
  log "Commit metadata received (install jq for parsed output)."
  CURRENT_COMMIT=""
else
  warn "Could not reach GitLab API."
  CURRENT_COMMIT=""
fi

# --- 2. GitLab: branches (detect WebKit branch) ---
section "GitLab Branches"

BRANCHES_JSON=$(curl -s --fail --location --max-time 15 "$GITLAB_BRANCHES" 2>/dev/null || echo "")

if [ -n "$BRANCHES_JSON" ] && command -v jq >/dev/null 2>&1; then
  CURRENT_BRANCH_COUNT=$(echo "$BRANCHES_JSON" | jq 'length')
  BRANCH_NAMES=$(echo "$BRANCHES_JSON" | jq -r '.[].name')
  log "Branch count: $CURRENT_BRANCH_COUNT"
  log "Branches: $(echo "$BRANCH_NAMES" | tr '\n' ', ' | sed 's/,$//')"

  if echo "$BRANCH_NAMES" | grep -iq "webkit\|browser\|web"; then
    notice "WebKit/browser-related branch found in upstream!"
  fi

  if [ -n "$PREV_BRANCH_COUNT" ] && [ "$PREV_BRANCH_COUNT" != "$CURRENT_BRANCH_COUNT" ]; then
    notice "Branch count changed: $PREV_BRANCH_COUNT → $CURRENT_BRANCH_COUNT"
  fi
else
  warn "Could not retrieve branch list."
  CURRENT_BRANCH_COUNT=""
fi

# --- 3. GitLab: tags (release detection) ---
section "GitLab Tags / Releases"

TAGS_JSON=$(curl -s --fail --location --max-time 15 "$GITLAB_TAGS" 2>/dev/null || echo "")

if [ -n "$TAGS_JSON" ] && command -v jq >/dev/null 2>&1; then
  CURRENT_TAG_COUNT=$(echo "$TAGS_JSON" | jq 'length')
  if [ "$CURRENT_TAG_COUNT" -gt 0 ]; then
    log "Tags found: $CURRENT_TAG_COUNT"
    echo "$TAGS_JSON" | jq -r '.[] | "  - \(.name) (\(.commit.id[0:8]))"'
  else
    log "No release tags yet."
  fi

  if [ -n "$PREV_TAG_COUNT" ] && [ "$PREV_TAG_COUNT" != "$CURRENT_TAG_COUNT" ]; then
    notice "Tag count changed: $PREV_TAG_COUNT → $CURRENT_TAG_COUNT"
  fi
else
  warn "Could not retrieve tags."
  CURRENT_TAG_COUNT=""
fi

# --- 4. README: WebKit references ---
section "README Content Check"

README_CONTENT=$(curl -s --fail --location --max-time 15 "$GITLAB_RAW_README" 2>/dev/null || echo "")

if [ -n "$README_CONTENT" ]; then
  if echo "$README_CONTENT" | grep -iq "webkit\|browser"; then
    notice "WebKit/browser references found in upstream README!"
    echo "$README_CONTENT" | grep -in -C 1 -E -i "webkit|browser" | sed 's/^/    /'
  else
    ok "No WebKit/browser entry point in README. SmileBASIC still required."
  fi
else
  warn "Could not retrieve upstream README."
fi

# --- 5. GitHub Gist: revision check ---
section "GitHub Gist (Shubin123/$GIST_ID)"

GIST_JSON=$(curl -s --fail --location --max-time 15 "$GIST_API" 2>/dev/null || echo "")

if [ -n "$GIST_JSON" ] && command -v jq >/dev/null 2>&1; then
  CURRENT_GIST_UPDATED=$(echo "$GIST_JSON" | jq -r '.updated_at // empty')
  GIST_DESC=$(echo "$GIST_JSON" | jq -r '.description // "(no description)"')
  GIST_FILES=$(echo "$GIST_JSON" | jq -r '.files | keys[]')
  GIST_REVISIONS=$(echo "$GIST_JSON" | jq -r '.history | length')

  log "Description:    $GIST_DESC"
  log "Last updated:   $CURRENT_GIST_UPDATED"
  log "Revision count: $GIST_REVISIONS"
  log "Files: $(echo "$GIST_FILES" | tr '\n' ', ' | sed 's/,$//')"

  if [ -n "$PREV_GIST_UPDATED" ] && [ "$PREV_GIST_UPDATED" != "$CURRENT_GIST_UPDATED" ]; then
    notice "Gist updated since last check: $PREV_GIST_UPDATED → $CURRENT_GIST_UPDATED"
  elif [ -n "$PREV_GIST_UPDATED" ]; then
    ok "Gist unchanged since last check."
  fi
else
  warn "Could not retrieve Gist metadata."
  CURRENT_GIST_UPDATED=""
fi

# --- 6. Reference URL validation ---
section "Reference URL Validation"

check_url() {
  local label="$1" url="$2"
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --location --max-time 10 "$url" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 400 ]; then
    ok "$label → HTTP $HTTP_CODE"
  else
    notice "$label → HTTP $HTTP_CODE (may be unreachable or removed)"
  fi
}

check_url "Upstream repo" "https://gitlab.com/pepsipu/ns2jb"
check_url "Author blog"   "$BLOG_URL"
check_url "Public Gist"   "https://gist.github.com/Shubin123/$GIST_ID"

# --- Save state and summary ---
save_state

echo ""
echo "======================================"
if [ "$CHANGES_DETECTED" -gt 0 ]; then
  echo " CHANGES DETECTED — review required:"
  echo -e "$REPORT"
else
  echo " No changes detected. All sources stable."
fi
echo ""
echo " State saved to .upstream-state.json"
echo " Next check: run this script again or use monitor-upstream.sh"
echo "======================================"
