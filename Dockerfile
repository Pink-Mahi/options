# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# Install OpenSSL for Prisma engine compatibility
RUN apk add --no-cache openssl

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

# Copy lockfile and package.json
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./

# Install dependencies (including devDependencies needed for build)
RUN NODE_ENV=development pnpm install --frozen-lockfile

# Copy source
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js
RUN pnpm build

# ---- Production stage ----
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl postgresql16 postgresql16-client openjdk21-jre curl wget && corepack enable && corepack prepare pnpm@10 --activate

ENV NODE_ENV=production
ENV DATABASE_URL=postgresql://opc:opc_dev_password@127.0.0.1:5432/opc?schema=public
# ThetaData credentials (optional — enables real historical options data)
ENV THETADATA_BASE_URL=http://127.0.0.1:25503/v3
# THETADATA_EMAIL and THETADATA_PASSWORD set at runtime from Coolify env vars

# Copy only what we need
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml* ./
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules ./node_modules

# Copy startup script
COPY start.sh ./
RUN chmod +x start.sh

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Download Theta Terminal JAR (auto-updating, ~41MB)
RUN wget -q -O /app/ThetaTerminalV3.jar https://download-stable.thetadata.us/ || echo "Theta Terminal download failed — backtester will use BS model only"

CMD ["./start.sh"]
