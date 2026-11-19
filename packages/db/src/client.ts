/**
 * One PrismaClient per process. In Next.js dev, modules reload on every
 * change; keeping the client on globalThis stops each reload from opening a
 * new connection pool.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { trackerPrisma?: PrismaClient };

export const prisma = globalForPrisma.trackerPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.trackerPrisma = prisma;

export { Prisma } from "@prisma/client";
export type { CompanyProfile, PrismaClient } from "@prisma/client";
