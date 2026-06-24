#!/bin/sh
set -e

# Alpine nginx uses /etc/nginx/http.d/ not /etc/nginx/conf.d/
NGINX_PORT=${PORT:-8080}
sed -i "s/listen 8080/listen $NGINX_PORT/" /etc/nginx/http.d/postiz.conf

# Unset PORT so postiz backend doesn't try to bind to nginx's port
unset PORT

# Start nginx
nginx -g "daemon off;" &

# Push prisma schema
cd /app
pnpm dlx prisma@6.5.0 db push \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma \
  --accept-data-loss || true

# Start postiz in background (keep shell alive so nginx doesn't die)
pnpm run pm2 &

# Wait for any child to exit
wait
