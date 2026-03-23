#!/bin/bash
# Auto-publish: inbox → optimize → commit → push → notify
# Triggered by launchd when files appear in inbox/
#
# Exit codes:
#   0 — success (published or nothing to do)
#   1 — publish.mjs failed
#   2 — git push failed

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

LOG_FILE="$PROJECT_DIR/scripts/.auto-publish.log"
NODE="/opt/homebrew/bin/node"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }
notify() {
  osascript -e "display notification \"$1\" with title \"Portfolio Auto-Publish\"" 2>/dev/null || true
}

# Prevent concurrent runs (launchd can re-trigger while we're still running)
LOCKDIR="$PROJECT_DIR/scripts/.auto-publish.lock"
if ! mkdir "$LOCKDIR" 2>/dev/null; then
  log "Another instance running, skipping"
  exit 0
fi
trap 'rmdir "$LOCKDIR" 2>/dev/null' EXIT

# Wait for file copies to finish (launchd triggers on first fs event)
sleep 5

# Check if there are publishable files in inbox
INBOX_FILE=$(find inbox -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.webp' \) -print -quit 2>/dev/null)
if [ -z "$INBOX_FILE" ]; then
  exit 0
fi

log "Starting auto-publish..."

# Run publish.mjs
if ! OUTPUT=$("$NODE" scripts/publish.mjs 2>&1); then
  log "ERROR: publish.mjs failed: $OUTPUT"
  notify "Publish failed — check log"
  exit 1
fi

log "$OUTPUT"

# Check if there are actual changes to commit
if git diff --quiet assets/images/ data/projects.js index.html project.html 2>/dev/null && \
   git diff --cached --quiet assets/images/ data/projects.js index.html project.html 2>/dev/null; then
  log "No changes to commit (publish ran but produced no diff)"
  exit 0
fi

# Stage and commit
git add assets/images/ data/projects.js index.html project.html
git commit -m "feat(content): auto-publish new images"

# Push
if ! git push origin main 2>&1; then
  log "ERROR: git push failed"
  notify "Published but push failed — push manually"
  exit 2
fi

log "Success: published and pushed"
notify "New images published"
exit 0
