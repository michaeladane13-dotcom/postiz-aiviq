#!/bin/sh
set -e

echo "[WRAPPER] Starting. PORT=$PORT"
NGINX_PORT=${PORT:-8080}

mkdir -p /run/nginx /var/lib/nginx/tmp

# Test config
nginx -t 2>&1

# Start nginx, capture stderr to file
nginx -g "daemon off;" 2>/tmp/nginx.err &
NGINX_PID=$!
echo "[WRAPPER] nginx started PID=$NGINX_PID"

sleep 2

# Check if nginx is still alive
if kill -0 $NGINX_PID 2>/dev/null; then
    echo "[WRAPPER] nginx is ALIVE after 2s"
else
    echo "[WRAPPER] nginx DIED. Error output:"
    cat /tmp/nginx.err
    echo "[WRAPPER] Trying to restart without daemon off..."
    nginx 2>&1 || true
fi

# Self-test
wget -qO- http://localhost:$NGINX_PORT/nginx-health 2>&1 && echo "[WRAPPER] NGINX OK" || echo "[WRAPPER] NGINX DEAD"

unset PORT
cd /app
pnpm dlx prisma@6.5.0 db push \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma \
  --accept-data-loss || true

pnpm run pm2 &
wait
