import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const COOKIE_NAME = "wallet_session";
const MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET env var is not set");
  return secret;
}

interface SessionPayload {
  walletAddress: string;
  userId: string;
  exp: number;
}

function signPayload(payload: SessionPayload): string {
  const secret = getSecret();
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("hex");
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): SessionPayload | null {
  const secret = getSecret();
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = createHmac("sha256", secret).update(encoded).digest("hex");

  // Timing-safe comparison
  try {
    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== expBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expBuf)) return null;
  } catch {
    return null;
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (!payload.walletAddress || !payload.userId || !payload.exp) return null;
  if (payload.exp < Date.now()) return null; // expired

  return payload;
}

/**
 * createSession — signs a payload and sets the httpOnly cookie on a NextResponse.
 * Pass the NextResponse to mutate, or pass null to get cookie value back.
 */
export async function createSession(
  walletAddress: string,
  userId: string,
  response: NextResponse
): Promise<void> {
  const payload: SessionPayload = {
    walletAddress: walletAddress.toLowerCase(),
    userId,
    exp: Date.now() + MAX_AGE * 1000,
  };
  const token = signPayload(payload);

  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
  });
}

/**
 * getSession — reads and verifies cookie from an incoming NextRequest or the
 * Next.js cookie store (server components / route handlers).
 */
export async function getSession(
  request?: NextRequest | Request
): Promise<{ walletAddress: string; userId: string } | null> {
  let token: string | undefined;

  if (request) {
    // Works in Route Handlers that receive a request object
    token = request.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1);
  } else {
    // Works in Server Components / Actions
    try {
      const store = await cookies();
      token = store.get(COOKIE_NAME)?.value;
    } catch {
      return null;
    }
  }

  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return { walletAddress: payload.walletAddress, userId: payload.userId };
}

/**
 * clearSession — sets cookie to expire immediately.
 */
export function clearSession(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
}
