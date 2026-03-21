/**
 * Prisma client singleton — prevents creating multiple PrismaClient instances
 * during Next.js hot-reload in development.
 *
 * In development, the client is cached on `globalThis` so it survives module
 * reloads. In production, a single instance is created and exported.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

// Cache the client on globalThis in dev to avoid exhausting DB connections on HMR
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
