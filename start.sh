#!/bin/sh
set -e

PGDATA=/var/lib/postgresql/data
PGUSER=postgres

# Initialize PostgreSQL if not already done
if [ ! -d "$PGDATA" ] || [ ! -f "$PGDATA/PG_VERSION" ]; then
  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$PGDATA"
  su postgres -c "initdb -D $PGDATA --auth=trust"

  # Configure to listen on all interfaces
  echo "listen_addresses = '*'" >> "$PGDATA/postgresql.conf"
  echo "port = 5432" >> "$PGDATA/postgresql.conf"
fi

# Start PostgreSQL
su postgres -c "pg_ctl -D $PGDATA -l /var/lib/postgresql/pg.log start -w"

# Wait for PostgreSQL to be ready
until su postgres -c "pg_isready -p 5432"; do
  echo "Waiting for PostgreSQL..."
  sleep 1
done

# Create database and user if they don't exist
su postgres -c "psql -p 5432 -tc \"SELECT 1 FROM pg_roles WHERE rolname='opc'\" | grep -q 1 || psql -p 5432 -c \"CREATE USER opc WITH PASSWORD 'opc_dev_password';\""
su postgres -c "psql -p 5432 -tc \"SELECT 1 FROM pg_database WHERE datname='opc'\" | grep -q 1 || psql -p 5432 -c \"CREATE DATABASE opc OWNER opc;\""
su postgres -c "psql -p 5432 -c \"GRANT ALL PRIVILEGES ON DATABASE opc TO opc;\""

# Run Prisma migrations
echo "Running Prisma migrations..."
npx prisma db push --skip-generate

# Start Next.js
echo "Starting Next.js..."
exec pnpm start
