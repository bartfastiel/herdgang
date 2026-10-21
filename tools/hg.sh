#!/usr/bin/env bash
# Runs the Herdgang command line on the server, e.g.
#   tools/hg.sh recipes
#   tools/hg.sh context "Pizza"
#   tools/hg.sh commit "Pizza" --parent 3 --author Daniel --message "20 g mehr Wasser" < pizza.txt
# HERDGANG_SSH: ssh host alias (default frag-daniel), HERDGANG_CONTAINER: container name.
set -euo pipefail
host="${HERDGANG_SSH:-frag-daniel}"
container="${HERDGANG_CONTAINER:-frag-daniel-herdgang-api-1}"
args=""
for a in "$@"; do args="$args $(printf '%q' "$a")"; done
exec ssh "$host" "docker exec -i $container node /srv/server/cli.mjs$args"
