#!/bin/sh
set -e

echo "[WRAPPER] Starting. PORT=$PORT"

NGINX_PORT=${PORT:-8080}
echo "[WRAPPER] nginx will listen on port $NGINX_PORT"

mkdir -p /run/nginx

sed -i "s/listen 8080/listen $NGINX_PORT/" /etc/nginx/http.d/postiz.conf

nginx -t 2>&1
nginx -g "daemon off;" &
NGINX_PID=$!
echo "[WRAPPER] nginx started PID=$NGINX_PID on port $NGINX_PORT"

# Self-test: verify nginx answers on the correct port from inside container
sleep 3
echo "[WRAPPER] Self-test: wget localhost:$NGINX_PORT/nginx-health"
wget -qO- http://localhost:$NGINX_PORT/nginx-health 2>&1 && echo "[WRAPPER] NGINX OK" || echo "[WRAPPER] NGINX SELF-TEST FAILED"

# Check what's actually listening
echo "[WRAPPER] Listening ports:"
ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "(ss/netstat not available)"

unset PORT

cd /app
echo "[WRAPPER] Running prisma db push..."
pnpm dlx prisma@6.5.0 db push \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma \
  --accept-data-loss || true

echo "[WRAPPER] Starting pm2..."
pnpm run pm2 &

wait
