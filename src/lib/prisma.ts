import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  // Strip channel_binding=require — not supported by Node.js pg driver
  const cleanUrl = connectionString.replace(/[&?]channel_binding=require/g, "");
  // Only enable SSL for remote databases — local postgres has no SSL
  const isRemote = !cleanUrl.includes("localhost") && !cleanUrl.includes("127.0.0.1");
  const pool = new Pool({ connectionString: cleanUrl, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, ssl: isRemote ? { rejectUnauthorized: false } : false });
  const adapter = new PrismaPg(pool);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (PrismaClient as any)({ adapter });
}

export const prisma: InstanceType<typeof PrismaClient> =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
