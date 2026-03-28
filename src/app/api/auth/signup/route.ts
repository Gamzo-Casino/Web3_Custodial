import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { initializeWallet, AIRDROP_AMOUNT } from "@/lib/ledger";
import { checkRateLimit } from "@/lib/rate-limit";

const signupSchema = z.object({
  name: z.string().min(2).max(50).trim(),
  email: z.string().email().toLowerCase().trim(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password too long"),
});

export async function POST(req: NextRequest) {
  // Rate limit by IP: 5 signups per hour per IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = checkRateLimit(`signup:${ip}`, 5, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Too many signup attempts. Retry after ${rl.retryAfter}s.` },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { name, email, password } = parsed.data;

  // Check uniqueness
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (prisma as any).user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Create user + wallet + airdrop in one transaction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = await (prisma as any).$transaction(async (tx: any) => {
    const newUser = await tx.user.create({
      data: { name, email, passwordHash },
      select: { id: true, email: true, name: true },
    });

    await initializeWallet(tx, newUser.id, AIRDROP_AMOUNT);

    await tx.auditLog.create({
      data: {
        userId: newUser.id,
        action: "USER_SIGNUP",
        entity: "User",
        entityId: newUser.id,
        ipAddress: ip,
      },
    });

    return newUser;
  });

  return NextResponse.json(
    { ok: true, userId: user.id, airdrop: AIRDROP_AMOUNT },
    { status: 201 }
  );
}
