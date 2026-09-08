import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

// ALWAYS cache on globalThis. Next.js bundles each route separately in
// production, so without this every route bundle creates its own PrismaClient
// with its own connection pool — several pools × (num_cpus × 2 + 1)
// connections each exhausts PostgreSQL's max_connections.
if (!globalForPrisma.prisma) globalForPrisma.prisma = prisma;
