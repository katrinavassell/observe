#!/usr/bin/env zsh
#
# Maps git changes to platform doc sections that need updating.
# Usage:
#   ./scripts/update-platform-doc.sh              # diff since last doc commit
#   ./scripts/update-platform-doc.sh HEAD~3       # diff against specific ref
#   ./scripts/update-platform-doc.sh abc123       # diff against specific commit

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="$REPO_ROOT/docs/observe-platform.html"

if [[ ! -f "$DOC" ]]; then
  echo "Error: $DOC not found"
  exit 1
fi

REF="${1:-}"

if [[ -z "$REF" ]]; then
  REF=$(git -C "$REPO_ROOT" log -1 --format=%H -- docs/observe-platform.html 2>/dev/null)
  if [[ -z "$REF" ]]; then
    echo "No previous doc commits found."
    REF="HEAD~10"
  fi
fi

echo "Diffing against: ${REF:0:7}"
echo ""

CHANGED=$(git -C "$REPO_ROOT" diff --name-only "$REF" -- . ':!docs/observe-platform.html' 2>/dev/null)

if [[ -z "$CHANGED" ]]; then
  echo "No code changes since ${REF:0:7}"
  exit 0
fi

typeset -aU HITS

check() {
  local pattern="$1"; shift
  if echo "$CHANGED" | grep -qE "$pattern"; then
    HITS+=("$@")
  fi
}

check "supabase/|\.sql$"                          erd definitions
check "server/routes/events"                      api changelog
check "server/routes/analytics|server/routes/metrics" api changelog
check "server/routes/stripe|server/routes/integrations" api definitions changelog
check "server/routes/billing"                     api emails changelog
check "server/routes/cohorts|server/routes/customers" api changelog
check "server/routes/proxy|server/routes/gateway" api changelog
check "server/lib/stripe|server/lib/revenue"      definitions changelog
check "server/lib/email|server/lib/resend"        emails changelog
check "server/lib/alert"                          changelog
check "server/boot"                               erd
check "src/views|src/pages"                       pages user-stories
check "src/components"                            pages
check "server/routes/"                            api

if [[ ${#HITS} -eq 0 ]]; then
  echo "Changed files don't map to any doc sections:"
  echo "$CHANGED" | sed 's/^/  /'
  exit 0
fi

SORTED=(${(o)HITS})

echo "Sections to update:"
for s in $SORTED; do
  LINE=$(grep -n "SECTION:${s} " "$DOC" 2>/dev/null | head -1 | cut -d: -f1)
  echo "  - $s (line ${LINE:-?})"
done

echo ""
echo "Changed files:"
echo "$CHANGED" | sed 's/^/  /'

JOINED="${(j:, :)SORTED}"
echo ""
echo "---"
echo "To update, tell Claude:"
echo "  \"Update the ${JOINED} sections in docs/observe-platform.html\""
