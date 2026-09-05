# ---- Build stage ----
FROM node:22-alpine AS builder

WORKDIR /app

ENV NODE_ENV=development

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

# Copy lockfile and package.json
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./

# Install dependencies (including devDependencies needed for build)
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build Next.js
RUN pnpm build

# ---- Production stage ----
FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

ENV NODE_ENV=production

# Copy only what we need
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml* ./
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run migrations on startup, then start the server
CMD npx prisma db push --skip-generate && pnpm start
