#!/bin/sh
set -eu

node /opt/postiz/postiz_container_guard.cjs
exec /usr/local/bin/docker-entrypoint.sh "$@"
