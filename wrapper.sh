#!/bin/sh
set -e

echo "[WRAPPER] Starting. PORT=$PORT"

# Alpine nginx uses /etc/nginx/http.d/ not /etc/nginx/conf.d/
NGINX_PORT=${PORT:-8080}
echo "[WRAPPER] nginx will listen on port $NGINX_PORT"

# Ensure nginx runtime directory exists
mkdir -p /run/nginx

# Substitute port in config
sed -i "s/listen 8080/listen $NGINX_PORT/" /etc/nginx/http.d/postiz.conf

# Test nginx config before starting
echo "[WRAPPER] Testing nginx config..."
nginx -t 2>&1
echo "[WRAPPER] nginx config OK, starting nginx..."

# Start nginx (daemon off keeps it in foreground; & backgrounds this shell command)
nginx -g "daemon off;" &
NGINX_PID=$!
echo "[WRAPPER] nginx started with PID $NGINX_PID"

# Unset PORT so postiz backend doesn't try to bind to nginx's port
unset PORT

# Push prisma schema
echo "[WRAPPER] Running prisma db push..."
cd /app
pnpm dlx prisma@6.5.0 db push \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma \
  --accept-data-loss || true

# Start postiz in background (keep shell alive so nginx doesn't die)
echo "[WRAPPER] Starting pm2..."
pnpm run pm2 &

# Wait for any child to exit (keeps shell/nginx alive)
wait
