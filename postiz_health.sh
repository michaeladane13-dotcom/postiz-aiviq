#!/bin/sh
set -eu

TAG=postiz-health
PG=58931499e356_postiz-postgres-1
ALERT_ENV=/etc/default/postiz-alert
failures=""

add_failure() {
  if [ -n "$failures" ]; then failures="$failures; $1"; else failures="$1"; fi
}

if ! /opt/postiz/postiz_clock_sanity.sh >/tmp/postiz-clock-health.$$ 2>&1; then
  add_failure "clock/NTP sanity failed"
fi
rm -f /tmp/postiz-clock-health.$$

free_kb="$(df -Pk / | awk 'NR == 2 {print $4}')"
[ "$free_kb" -ge 1048576 ] || add_failure "root disk below 1GB"

postgres_state="$(docker inspect -f '{{.State.Status}}' "$PG" 2>/dev/null || true)"
redis_container="$(docker compose -f /opt/postiz/docker-compose.yml ps -q redis 2>/dev/null || true)"
nginx_container="$(docker compose -f /opt/postiz/docker-compose.yml ps -q nginx 2>/dev/null || true)"
redis_state="$(docker inspect -f '{{.State.Status}}' "$redis_container" 2>/dev/null || true)"
nginx_state="$(docker inspect -f '{{.State.Status}}' "$nginx_container" 2>/dev/null || true)"
[ "$postgres_state" = running ] || add_failure "Postgres not running"
[ "$redis_state" = running ] || add_failure "Redis not running"
[ "$nginx_state" = running ] || add_failure "Nginx not running"

expected=stopped
if [ -r /opt/postiz/POSTIZ_EXPECTED_STATE ]; then
  expected="$(tr -d '[:space:]' < /opt/postiz/POSTIZ_EXPECTED_STATE)"
fi
postiz_state="$(docker inspect -f '{{.State.Status}}' postiz-postiz-1 2>/dev/null || true)"
postiz_expected_state="$postiz_state"
case "$postiz_state" in
  created|exited|stopped) postiz_expected_state=stopped ;;
  running) postiz_expected_state=running ;;
  *) postiz_expected_state=missing ;;
esac
[ "$expected" = "$postiz_expected_state" ] || add_failure "Postiz state is ${postiz_state:-missing}; expected $expected"

queue_summary="$(docker exec -i "$PG" psql -U postiz -d postiz -At -F '|' <<'SQL'
WITH queue AS (
  SELECT p.*, coalesce(i.name, '') AS integration_name
  FROM "Post" p LEFT JOIN "Integration" i ON i.id = p."integrationId"
  WHERE p.state = 'QUEUE'
), duplicates AS (
  SELECT "integrationId", "publishDate" FROM queue GROUP BY 1,2 HAVING count(*) > 1
), invalid AS (
  SELECT 1 FROM queue
  WHERE "publishDate" <= (NOW() AT TIME ZONE 'UTC')
     OR extract(minute FROM "publishDate") <> 0
     OR extract(second FROM "publishDate") <> 0
     OR (CASE WHEN integration_name ~* '(quiet\s*moon|aiviq|daniel)'
              THEN extract(hour FROM "publishDate") NOT IN (10,16,22)
              ELSE extract(hour FROM "publishDate") NOT IN (16,22)
        END)
)
SELECT (SELECT count(*) FROM queue),
       (SELECT count(*) FROM queue WHERE "publishDate" <= (NOW() AT TIME ZONE 'UTC')),
       (SELECT count(*) FROM duplicates),
       (SELECT count(*) FROM invalid);
SQL
)"

if [ -z "$queue_summary" ]; then
  add_failure "queue query failed"
else
  IFS='|' read -r queue_count past_count duplicate_count invalid_count <<EOF
$queue_summary
EOF
  [ "${past_count:-1}" -eq 0 ] || add_failure "${past_count:-unknown} past QUEUE posts"
  [ "${duplicate_count:-1}" -eq 0 ] || add_failure "${duplicate_count:-unknown} duplicate queue pairs"
  [ "${invalid_count:-1}" -eq 0 ] || add_failure "${invalid_count:-unknown} invalid queue slots"
fi

if [ -n "$failures" ]; then
  message="Postiz health FAILED: $failures"
  logger -t "$TAG" -p daemon.crit -- "$message" || true
  if [ -r "$ALERT_ENV" ]; then
    # shellcheck disable=SC1091
    . "$ALERT_ENV"
    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
      curl -fsS --max-time 10 --config - <<EOF >/dev/null || true
url = https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage
request = POST
data-urlencode = chat_id:${TELEGRAM_CHAT_ID}
data-urlencode = text:${message}
EOF
    fi
  fi
  echo "[$TAG] $message" >&2
  exit 1
fi

echo "[$TAG] OK queue=${queue_count:-unknown} disk_free_kb=$free_kb postiz=$postiz_state"
