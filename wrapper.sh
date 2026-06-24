#!/bin/sh
set -e

echo "[WRAPPER] Starting. PORT=$PORT"
NGINX_PORT=${PORT:-8080}

# Fix port in nginx config
sed -i "s/listen 8080/listen $NGINX_PORT/" /etc/nginx/http.d/postiz.conf

# Test config
nginx -t 2>&1

# Start nginx
nginx -g "daemon off;" 2>/tmp/nginx.err &
NGINX_PID=$!
sleep 2

if kill -0 $NGINX_PID 2>/dev/null; then
    echo "[WRAPPER] nginx ALIVE"
else
    echo "[WRAPPER] nginx DIED"
fi

echo "[WRAPPER] nginx log:"
cat /tmp/nginx.err 2>/dev/null || true

# TCP check
node -e "
const net = require('net');
const c = net.createConnection({host:'127.0.0.1', port:$NGINX_PORT}, () => {
  console.log('[WRAPPER] TCP OK on $NGINX_PORT');
  c.end();
});
c.on('error', e => console.log('[WRAPPER] TCP FAIL:', e.message));
setTimeout(() => process.exit(0), 2000);
" 2>&1

unset PORT
cd /app
pnpm dlx prisma@6.5.0 db push \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma \
  --accept-data-loss || true

pnpm run pm2 &
wait
