#!/bin/bash
set -e

export BACK_END_PORT=3001

# Remove default nginx site
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Start nginx on port 8080
nginx -g "daemon off;" &

# Push prisma schema
cd /app
pnpm dlx prisma@6.5.0 db push \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma \
  --accept-data-loss || true

# Start postiz (frontend + backend + workers via pm2)
exec pnpm run pm2
