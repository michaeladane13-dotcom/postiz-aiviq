#!/bin/sh
set -e

echo "[WRAPPER] Starting PORT=$PORT"
NGINX_PORT=${PORT:-8080}

# Patch port in nginx.conf
sed -i "s/listen 8080/listen $NGINX_PORT/" /etc/nginx/nginx.conf

nginx -t 2>&1
nginx -g "daemon off;" 2>&1 &
NGINX_PID=$!
sleep 2

echo "[WRAPPER] nginx alive: $(kill -0 $NGINX_PID 2>&1 && echo YES || echo NO)"
node -e "
const net = require('net');
const s = net.createServer();
s.listen($NGINX_PORT, '0.0.0.0', () => { console.log('[WRAPPER] port $NGINX_PORT IS FREE - nginx NOT bound'); s.close(); });
s.on('error', () => console.log('[WRAPPER] port $NGINX_PORT IN USE - nginx IS bound'));
setTimeout(() => process.exit(0), 2000);
"

unset PORT
cd /app
pnpm dlx prisma@6.5.0 db push \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma \
  --accept-data-loss || true

pnpm run pm2 &
wait
