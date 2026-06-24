#!/bin/bash
set -e

# Move backend to port 3001 so nginx can sit on port 3000
export BACK_END_PORT=3001

# Write nginx config
mkdir -p /etc/nginx/conf.d
cat /nginx-internal.conf > /etc/nginx/conf.d/default.conf

# Remove default nginx site if exists
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Start nginx in background
nginx -g "daemon off;" &

# Run original entrypoint
exec /start.sh
