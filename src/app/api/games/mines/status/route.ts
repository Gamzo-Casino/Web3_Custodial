/**
 * GET /api/games/mines/status?roundId=0x...
 *
 * Polls the MinesGame contract for the VRF status of a custodial round.
 * Returns PENDING until VRF fulfills, then ACTIVE with mine positions.
 * Called by the frontend every 3 s while waiting for Chainlink VRF.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/getAuthUser";
import { getPublicClient, MINES_GAME_ABI } from "@/lib/viemServer";

const MINES_GAME_ADDRESS = "0x55d8093C2e75E682f6183EC78e4D35641010046f" as const;

// RoundStatus enum mirror
const STATUS_PENDING    = 0;
const STATUS_ACTIVE     = 1;
const STATUS_CASHED_OUT = 2;
const STATUS_LOST       = 3;
const STATUS_REFUNDED   = 4;

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roundId = req.nextUrl.searchParams.get("roundId");
  if (!roundId) {
    return NextResponse.json({ error: "roundId is required" }, { status: 400 });
  }

  try {
    const publicClient = getPublicClient();

    const round = await publicClient.readContract({
      address:      MINES_GAME_ADDRESS,
      abi:          MINES_GAME_ABI,
      functionName: "getRound",
      args:         [roundId as `0x${string}`],
    }) as { status: number; mineCount: number; safePicks: bigint; multiplier100: bigint; netPayout: bigint; custodial: boolean };

    const status = Number(round.status);

    if (status === STATUS_PENDING) {
      return NextResponse.json({ status: "PENDING" });
    }

    if (status === STATUS_ACTIVE) {
      // Fetch mine positions now that VRF seed is available
      const positions = await publicClient.readContract({
        address:      MINES_GAME_ADDRESS,
        abi:          MINES_GAME_ABI,
        functionName: "getMinePositions",
        args:         [roundId as `0x${string}`],
      }) as readonly number[];

      return NextResponse.json({
        status:        "ACTIVE",
        minePositions: Array.from(positions).map(Number),
        mineCount:     Number(round.mineCount),
      });
    }

    if (status === STATUS_CASHED_OUT) {
      return NextResponse.json({
        status:       "CASHED_OUT",
        safePicks:    Number(round.safePicks),
        multiplier100: Number(round.multiplier100),
        netPayout:    Number(round.netPayout),
      });
    }

    if (status === STATUS_LOST) {
      return NextResponse.json({ status: "LOST" });
    }

    if (status === STATUS_REFUNDED) {
      return NextResponse.json({ status: "REFUNDED" });
    }

    return NextResponse.json({ status: "UNKNOWN" });
  } catch (err) {
    console.error("mines/status error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
