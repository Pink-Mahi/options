#!/bin/sh
set -e

PGDATA=/var/lib/postgresql/data
PGLOG=/var/lib/postgresql/pg.log

# Ensure postgres user exists and owns the data directory
mkdir -p "$PGDATA"
chown -R postgres:postgres /var/lib/postgresql

# Initialize PostgreSQL if not already done
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "Initializing PostgreSQL..."
  su postgres -c "initdb -D $PGDATA --auth=trust"

  # Configure PostgreSQL for container environment
  cat >> "$PGDATA/postgresql.conf" <<EOF
listen_addresses = '*'
port = 5432
unix_socket_directories = '/tmp'
dynamic_shared_memory_type = mmap
shared_buffers = 32MB
max_connections = 50
EOF
fi

# Start PostgreSQL
echo "Starting PostgreSQL..."
su postgres -c "pg_ctl -D $PGDATA -l $PGLOG -o '-c config_file=$PGDATA/postgresql.conf' start -w" || {
  echo "=== PostgreSQL failed to start. Log output: ==="
  cat "$PGLOG" 2>/dev/null || echo "(no log file found)"
  exit 1
}

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to accept connections..."
for i in $(seq 1 30); do
  if su postgres -c "pg_isready -h 127.0.0.1 -p 5432" 2>/dev/null; then
    break
  fi
  echo "  ...waiting ($i)"
  sleep 1
done

# Create database and user if they don't exist
echo "Setting up database and user..."
su postgres -c "psql -h 127.0.0.1 -p 5432 -tc \"SELECT 1 FROM pg_roles WHERE rolname='opc'\" | grep -q 1 || psql -h 127.0.0.1 -p 5432 -c \"CREATE USER opc WITH PASSWORD 'opc_dev_password';\""
su postgres -c "psql -h 127.0.0.1 -p 5432 -tc \"SELECT 1 FROM pg_database WHERE datname='opc'\" | grep -q 1 || psql -h 127.0.0.1 -p 5432 -c \"CREATE DATABASE opc OWNER opc;\""
su postgres -c "psql -h 127.0.0.1 -p 5432 -c \"GRANT ALL PRIVILEGES ON DATABASE opc TO opc;\""

echo "PostgreSQL is ready."

# Run Prisma migrations
echo "Running Prisma migrations..."
npx prisma db push --skip-generate

# Start Next.js
echo "Starting Next.js..."
exec pnpm start
