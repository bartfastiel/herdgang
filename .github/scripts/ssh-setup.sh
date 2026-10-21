#!/usr/bin/env bash
# Writes the SSH key from DEPLOY_SSH_KEY and adds DEPLOY_HOST to known_hosts.
set -euo pipefail
: "${DEPLOY_HOST:?}" "${DEPLOY_SSH_KEY:?}"
mkdir -p ~/.ssh && chmod 700 ~/.ssh
printf '%s\n' "$DEPLOY_SSH_KEY" > ~/.ssh/id_ed25519 && chmod 600 ~/.ssh/id_ed25519
ssh-keyscan -H "$DEPLOY_HOST" >> ~/.ssh/known_hosts 2>/dev/null
