import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/walletSession";
import { prisma } from "@/lib/prismaClient";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function PATCH(request: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, email } = body as Record<string, unknown>;

  // Validate inputs
  if (name !== undefined && name !== null) {
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name must be a string" }, { status: 400 });
    }
    if (name.length > 50) {
      return NextResponse.json({ error: "name must be 50 characters or fewer" }, { status: 400 });
    }
  }

  if (email !== undefined && email !== null && email !== "") {
    if (typeof email !== "string" || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }
    // Check email uniqueness — another user should not have it
    const existing = await prisma.user.findFirst({
      where: {
        email: email as string,
        NOT: { id: session.userId },
      },
    });
    if (existing) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = (name as string).trim() || null;
  if (email !== undefined) {
    updateData.email =
      email === null || email === "" ? null : (email as string).toLowerCase().trim();
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  let user: Record<string, unknown>;
  try {
    user = await prisma.user.update({
      where: { id: session.userId },
      data: updateData,
      select: {
        id: true,
        walletAddress: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });
  } catch (err: unknown) {
    console.error("[wallet/profile] DB error:", err);
    // Unique constraint violation on email
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ user });
}
