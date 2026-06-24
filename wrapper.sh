#!/bin/sh
set -e

echo "[WRAPPER] Starting. PORT=$PORT"
NGINX_PORT=${PORT:-8080}

mkdir -p /run/nginx /var/lib/nginx/tmp

nginx -t 2>&1
nginx -g "daemon off;" 2>/tmp/nginx.err &
NGINX_PID=$!
echo "[WRAPPER] nginx PID=$NGINX_PID"

sleep 2

if kill -0 $NGINX_PID 2>/dev/null; then
    echo "[WRAPPER] nginx ALIVE"
else
    echo "[WRAPPER] nginx DIED:"
    cat /tmp/nginx.err
fi

# Check using node (installed), not wget
echo "[WRAPPER] Port check via node:"
node -e "
const net = require('net');
const c = net.createConnection({host:'127.0.0.1', port: $NGINX_PORT}, () => {
  console.log('[WRAPPER] TCP CONNECT OK on port $NGINX_PORT');
  c.write('GET /nginx-health HTTP/1.0\r\nHost: localhost\r\n\r\n');
});
c.on('data', d => { console.log('[WRAPPER] RESPONSE:', d.toString().split('\r\n')[0]); c.end(); });
c.on('error', e => console.log('[WRAPPER] TCP ERROR:', e.message));
setTimeout(() => process.exit(0), 3000);
" 2>&1

unset PORT
cd /app
pnpm dlx prisma@6.5.0 db push \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma \
  --accept-data-loss || true

pnpm run pm2 &
wait
