#!/bin/sh
set -e

# PostgreSQL runs in a SEPARATE container (the "db" service in docker-compose).
# We just wait for it to accept connections, then run migrations and start the app.

DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\).*/\1/p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_PORT=${DB_PORT:-5432}

echo "Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT}..."
for i in $(seq 1 60); do
  if nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; then
    echo "  PostgreSQL is reachable."
    break
  fi
  echo "  ...waiting ($i)"
  sleep 2
done

# Verify we can actually connect
if ! nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; then
  echo "ERROR: Could not connect to PostgreSQL at ${DB_HOST}:${DB_PORT} after 120s."
  echo "DATABASE_URL=$DATABASE_URL"
  exit 1
fi

# Run Prisma migrations
echo "Running Prisma migrations..."
npx prisma db push --skip-generate

# Seed admin user from env vars (ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME)
echo "Seeding admin user..."
node scripts/seed-admin.mjs

# Start Next.js
echo "Starting Next.js on port ${PORT:-3000}..."
exec npx next start -p "${PORT:-3000}" -H "${HOSTNAME:-0.0.0.0}"
