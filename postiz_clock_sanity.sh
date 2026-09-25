#!/bin/sh
set -eu

TAG=postiz-clock-sanity
MAX_SKEW_SECONDS=120

fail() {
  logger -t "$TAG" -p daemon.crit -- "$*" || true
  echo "[$TAG] $*" >&2
  exit 1
}

[ "$(timedatectl show -p NTPSynchronized --value)" = "yes" ] || fail "systemd does not report NTP synchronized"
[ "$(systemctl is-active systemd-timesyncd)" = "active" ] || fail "systemd-timesyncd is not active"

trusted_header="$(curl -fsSIL --max-time 10 https://www.google.com/generate_204 | awk 'BEGIN {IGNORECASE=1} /^date:/ {sub(/\r$/, ""); sub(/^[^:]*:[[:space:]]*/, ""); print; exit}')" || fail "could not obtain trusted HTTPS time"
[ -n "$trusted_header" ] || fail "trusted HTTPS response had no Date header"
trusted_epoch="$(date -u -d "$trusted_header" +%s 2>/dev/null)" || fail "could not parse trusted HTTPS time"
local_epoch="$(date -u +%s)"
diff=$((local_epoch - trusted_epoch))
[ "$diff" -ge 0 ] || diff=$((-diff))
[ "$diff" -le "$MAX_SKEW_SECONDS" ] || fail "clock skew is ${diff}s"

echo "[$TAG] synchronized; skew=${diff}s"
