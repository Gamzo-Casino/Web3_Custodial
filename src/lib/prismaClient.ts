import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Strip channel_binding=require — not supported by Node.js pg driver
const rawUrl = process.env.DATABASE_URL!;
const connectionString = rawUrl.replace(/[&?]channel_binding=require/g, "");

// Only enable SSL for remote databases (Neon, RDS, etc.) — local postgres has no SSL
const isRemote = !connectionString.includes("localhost") && !connectionString.includes("127.0.0.1");

const pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: isRemote ? { rejectUnauthorized: false } : false,
});
const adapter = new PrismaPg(pool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const prisma = new (PrismaClient as any)({ adapter }) as any;
