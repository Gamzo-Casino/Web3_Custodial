-- CreateEnum
CREATE TYPE "SkyRushRoundStatus" AS ENUM ('WAITING', 'RUNNING', 'CRASHED', 'SETTLED');

-- CreateEnum
CREATE TYPE "SkyRushBetStatus" AS ENUM ('PLACED', 'CASHED_OUT', 'LOST', 'VOID');

-- CreateTable
CREATE TABLE "SkyRushRound" (
    "id" TEXT NOT NULL,
    "roundNumber" SERIAL NOT NULL,
    "status" "SkyRushRoundStatus" NOT NULL DEFAULT 'WAITING',
    "countdownStartAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "crashedAt" TIMESTAMP(3),
    "crashMultiplier" DOUBLE PRECISION,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "publicSeed" TEXT NOT NULL,
    "fairnessVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkyRushRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkyRushBet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "betSlot" TEXT NOT NULL DEFAULT 'A',
    "stakeGzo" DECIMAL(18,8) NOT NULL,
    "autoCashoutMultiplier" DOUBLE PRECISION,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SkyRushBetStatus" NOT NULL DEFAULT 'PLACED',
    "cashoutMultiplier" DOUBLE PRECISION,
    "grossPayoutGzo" DECIMAL(18,8),
    "profitGzo" DECIMAL(18,8),
    "feeGzo" DECIMAL(18,8),
    "netPayoutGzo" DECIMAL(18,8),
    "idempotencyKey" TEXT NOT NULL,
    "resultJson" JSONB,

    CONSTRAINT "SkyRushBet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkyRushRound_roundNumber_key" ON "SkyRushRound"("roundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SkyRushBet_idempotencyKey_key" ON "SkyRushBet"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SkyRushBet_userId_idx" ON "SkyRushBet"("userId");

-- CreateIndex
CREATE INDEX "SkyRushBet_roundId_idx" ON "SkyRushBet"("roundId");

-- CreateIndex
CREATE INDEX "SkyRushBet_status_idx" ON "SkyRushBet"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SkyRushBet_roundId_userId_betSlot_key" ON "SkyRushBet"("roundId", "userId", "betSlot");

-- AddForeignKey
ALTER TABLE "SkyRushBet" ADD CONSTRAINT "SkyRushBet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkyRushBet" ADD CONSTRAINT "SkyRushBet_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "SkyRushRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
