#!/bin/sh
set -eu

/opt/postiz/postiz_clock_sanity.sh

free_kb="$(df -Pk / | awk 'NR == 2 {print $4}')"
[ "$free_kb" -ge 1048576 ] || {
  logger -t postiz-preflight -p daemon.crit -- "less than 1GB free on root filesystem" || true
  echo "[postiz-preflight] less than 1GB free on root filesystem" >&2
  exit 1
}

postgres_state="$(docker inspect -f '{{.State.Status}}' 58931499e356_postiz-postgres-1 2>/dev/null || true)"
redis_container="$(docker compose -f /opt/postiz/docker-compose.yml ps -q redis 2>/dev/null || true)"
redis_state="$(docker inspect -f '{{.State.Status}}' "$redis_container" 2>/dev/null || true)"
[ "$postgres_state" = running ] || { echo "[postiz-preflight] Postgres is not running" >&2; exit 1; }
[ "$redis_state" = running ] || { echo "[postiz-preflight] Redis is not running" >&2; exit 1; }

postiz_state="$(docker inspect -f '{{.State.Status}}' postiz-postiz-1 2>/dev/null || true)"
[ "$postiz_state" != running ] || { echo "[postiz-preflight] Postiz is already running" >&2; exit 1; }

echo "[postiz-preflight] safe to invoke guarded Postiz start"
