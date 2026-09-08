#!/bin/sh
set -e

PGDATA=/var/lib/postgresql/data
PGLOG=/var/lib/postgresql/pg.log

# PostgreSQL runs inside this container — always use localhost.
# connection_limit=5 caps the Prisma pool so route handlers can never
# exhaust Postgres max_connections (everything runs in one container).
export DATABASE_URL="postgresql://opc:opc_dev_password@127.0.0.1:5432/opc?schema=public&connection_limit=5&pool_timeout=30"

# Ensure postgres user exists and owns the data directory
mkdir -p "$PGDATA"
chown -R postgres:postgres /var/lib/postgresql

# Initialize PostgreSQL if not already done
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "Initializing PostgreSQL (fresh database — no existing data found at $PGDATA)..."
  su postgres -c "initdb -D $PGDATA --auth=trust"

  cat >> "$PGDATA/postgresql.conf" <<EOF
listen_addresses = '*'
port = 5432
unix_socket_directories = '/tmp'
dynamic_shared_memory_type = mmap
shared_buffers = 32MB
max_connections = 200
EOF
else
  echo "Found existing PostgreSQL data at $PGDATA — volume persisted correctly."
fi

# Start PostgreSQL — max_connections forced to 200 on the command line so it
# also overrides the lower value baked into existing persisted data dirs.
su postgres -c "pg_ctl -D $PGDATA -l $PGLOG -o '-c config_file=$PGDATA/postgresql.conf -c max_connections=200' start -w" || {
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

# Seed admin user from env vars (ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME)
echo "Seeding admin user..."
node scripts/seed-admin.mjs

# Start Theta Terminal if credentials are provided
if [ -f /app/ThetaTerminalV3.jar ] && [ -n "$THETADATA_EMAIL" ] && [ -n "$THETADATA_PASSWORD" ]; then
  echo "Starting Theta Terminal..."
  # Create creds.txt for the terminal
  printf "%s\n%s\n" "$THETADATA_EMAIL" "$THETADATA_PASSWORD" > /app/creds.txt
  # Start terminal in background, redirect output to log
  java -jar /app/ThetaTerminalV3.jar > /tmp/thetadata.log 2>&1 &
  THETA_PID=$!
  echo "Theta Terminal started in background (PID: $THETA_PID). It will become available at http://127.0.0.1:25503 once authentication completes."

  # Watchdog: report readiness or failure in the container logs (does not block Next.js)
  (
    READY=0
    for i in $(seq 1 120); do
      if curl -s -o /dev/null -m 2 "http://127.0.0.1:25503/v3"; then
        READY=1
        echo "Theta Terminal is ready on port 25503 (after ${i}s)."
        break
      fi
      if ! kill -0 "$THETA_PID" 2>/dev/null; then
        echo "WARNING: Theta Terminal process (PID $THETA_PID) exited after ${i}s. Log output:"
        tail -n 40 /tmp/thetadata.log 2>/dev/null || echo "(no log output)"
        break
      fi
      sleep 1
    done
    if [ "$READY" -ne 1 ] && kill -0 "$THETA_PID" 2>/dev/null; then
      echo "WARNING: Theta Terminal still not reachable on port 25503 after 120s. Last log lines:"
      tail -n 40 /tmp/thetadata.log 2>/dev/null || echo "(no log output)"
    fi
  ) &
else
  echo "Theta Terminal not started (no JAR or missing THETADATA_EMAIL/THETADATA_PASSWORD). Backtester will use BS model."
fi

# Start Next.js (don't wait for terminal — it connects in background)
echo "Starting Next.js on port ${PORT:-3000}..."
exec npx next start -p "${PORT:-3000}" -H "${HOSTNAME:-0.0.0.0}"
