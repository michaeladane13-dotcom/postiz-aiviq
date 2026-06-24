#!/bin/sh
set -e

echo "[WRAPPER] Starting PORT=$PORT"
NGINX_PORT=${PORT:-8080}

# Patch port in nginx.conf
sed -i "s/listen 8080/listen $NGINX_PORT/" /etc/nginx/nginx.conf

nginx -t 2>&1
nginx -g "daemon off;" 2>&1 &
sleep 3

unset PORT
cd /app
pnpm dlx prisma@6.5.0 db push \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma \
  --accept-data-loss || true

pnpm run pm2 &
wait
