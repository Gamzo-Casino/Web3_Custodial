import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { computeOutcome } from "@/lib/coinflip";
import { hmacSha256Bytes, bytesToFloat, RNG_VERSION } from "@/lib/rng";
import { z } from "zod";

const bodySchema = z.object({
  serverSeed: z.string().min(1),
  clientSeed: z.string().min(1),
  publicSeed: z.string().min(1),
  nonce: z.number().int().min(0).optional().default(1),
  /** Optional: the commitment hash to verify against (SHA-256 of serverSeed). */
  commitHash: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { serverSeed, clientSeed, publicSeed, nonce, commitHash } = body;

  // Compute the HMAC bytes (the raw RNG stream)
  const bytes = hmacSha256Bytes(serverSeed, clientSeed, publicSeed, nonce);
  const hmacHex = bytes.toString("hex");

  // Derived values from the RNG stream
  const floatValue = bytesToFloat(bytes);
  const highNibble = (bytes[0] >> 4) & 0xf;

  // Game outcome
  const outcome = computeOutcome(serverSeed, clientSeed, publicSeed, nonce);

  // Commitment verification
  const computedHash = createHash("sha256").update(serverSeed).digest("hex");
  const hashVerified = commitHash ? computedHash === commitHash : null;

  return NextResponse.json({
    outcome,
    rngVersion: RNG_VERSION,
    // Raw RNG stream
    hmacHex,
    // Derived values for full transparency
    firstByte: bytes[0],
    highNibble,
    floatValue,
    // Commitment check
    computedHash,
    hashVerified,
  });
}
