#!/bin/sh
set -e

echo "[WRAPPER] Starting. PORT=$PORT"
NGINX_PORT=${PORT:-8080}

sed -i "s/listen 8080/listen $NGINX_PORT/" /etc/nginx/http.d/postiz.conf

echo "[WRAPPER] nginx.conf user line:"
grep -E "^user" /etc/nginx/nginx.conf || echo "(no user line)"

echo "[WRAPPER] nginx.conf worker_processes line:"
grep -E "worker_processes" /etc/nginx/nginx.conf || echo "(none)"

nginx -t 2>&1

nginx -g "daemon off;" 2>/tmp/nginx.err &
NGINX_PID=$!
sleep 3

echo "[WRAPPER] nginx alive: $(kill -0 $NGINX_PID 2>&1 && echo YES || echo NO)"
echo "[WRAPPER] nginx stderr:"
cat /tmp/nginx.err 2>/dev/null || true
echo "[WRAPPER] nginx error log:"
cat /var/log/nginx/error.log 2>/dev/null | head -20 || true

echo "[WRAPPER] All TCP listeners (/proc/net/tcp):"
awk 'NR>1 && $4=="0A" {printf "port %d\n", strtonum("0x"substr($2,10,4))}' /proc/net/tcp 2>/dev/null || echo "(no /proc/net/tcp)"

# Check if 8080 is free or taken
node -e "
const net = require('net');
const s = net.createServer();
s.listen($NGINX_PORT, '0.0.0.0', () => { console.log('[WRAPPER] port $NGINX_PORT IS FREE (nginx NOT bound)'); s.close(); });
s.on('error', e => { console.log('[WRAPPER] port $NGINX_PORT IN USE (nginx IS bound):', e.code); });
" || true

unset PORT
cd /app
pnpm dlx prisma@6.5.0 db push \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma \
  --accept-data-loss || true

pnpm run pm2 &
wait
