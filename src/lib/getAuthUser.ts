/**
 * Unified auth helper — works for both NextAuth (email/password) users
 * and SIWE wallet-session users.
 *
 * Returns { userId, walletAddress? } or null if not authenticated.
 */
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/walletSession";
import type { NextRequest } from "next/server";

export interface AuthUser {
  userId: string;
  walletAddress?: string;
}

export async function getAuthUser(req?: NextRequest | Request): Promise<AuthUser | null> {
  // 1. Try wallet session (SIWE — primary for this app)
  const walletSession = await getSession(req);
  if (walletSession?.userId) {
    return { userId: walletSession.userId, walletAddress: walletSession.walletAddress };
  }

  // 2. Fallback to NextAuth (email/password users)
  try {
    const nextAuthSession = await auth();
    if (nextAuthSession?.user?.id) {
      return { userId: nextAuthSession.user.id };
    }
  } catch {
    // auth() can throw in contexts where Next.js headers aren't available
  }

  return null;
}
