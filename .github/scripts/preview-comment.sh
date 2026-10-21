#!/usr/bin/env bash
# One preview comment per pull request (marker <!-- preview -->): updated instead of re-created.
#   PREVIEW_STATUS=deployed  PREVIEW_URL=<address> DEPLOYED_COMMIT=<sha>
#   PREVIEW_STATUS=removed
set -euo pipefail
: "${GITHUB_REPOSITORY:?}" "${PULL_REQUEST_NUMBER:?}" "${PREVIEW_STATUS:?}"
marker='<!-- preview -->'

case "$PREVIEW_STATUS" in
  deployed)
    : "${PREVIEW_URL:?}" "${DEPLOYED_COMMIT:?}"
    body="$marker
### Preview

${PREVIEW_URL} – commit \`${DEPLOYED_COMMIT:0:7}\` (merged with \`main\`).

Updated on every push, removed when the pull request is closed."
    ;;
  removed)
    body="$marker
### Preview

Removed after the pull request was closed. Reopening creates it again."
    ;;
  *)
    echo "::error::PREVIEW_STATUS must be deployed or removed, not: $PREVIEW_STATUS"
    exit 1
    ;;
esac

comments="repos/$GITHUB_REPOSITORY/issues/$PULL_REQUEST_NUMBER/comments"
id="$(gh api "$comments" --paginate --jq ".[] | select(.body | startswith(\"$marker\")) | .id" | head -n 1)"
if [ -n "$id" ]; then
  gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$id" -f body="$body" --jq '"Comment updated: " + .html_url'
elif [ "$PREVIEW_STATUS" = deployed ]; then
  gh api --method POST "$comments" -f body="$body" --jq '"Comment created: " + .html_url'
else
  echo "No preview comment present – nothing to update."
fi
