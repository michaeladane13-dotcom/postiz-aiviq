#!/bin/sh
set -eu

free_kb="$(df -Pk / | awk 'NR == 2 {print $4}')"
if [ "$free_kb" -lt 1048576 ]; then
  logger -t postiz-disk-guard -p daemon.crit -- "less than 1GB free; stopping Postiz and blocking uploads" || true
  if [ "$(docker inspect -f '{{.State.Status}}' postiz-postiz-1 2>/dev/null || true)" = running ]; then
    docker stop --time 30 postiz-postiz-1
  fi
  exit 1
fi

exit 0
