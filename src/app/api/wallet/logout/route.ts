import { NextResponse } from "next/server";
import { clearSession } from "@/lib/walletSession";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearSession(response);
  return response;
}
