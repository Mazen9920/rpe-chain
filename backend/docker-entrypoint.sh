#!/bin/sh
set -e

echo "[entrypoint] applying prisma migrations..."
npx prisma migrate deploy

if [ "${SEED_ON_BOOT:-false}" = "true" ]; then
  echo "[entrypoint] seeding database..."
  node prisma/seed.js || echo "[entrypoint] seed failed (continuing)"
fi

echo "[entrypoint] starting: $@"
exec "$@"
