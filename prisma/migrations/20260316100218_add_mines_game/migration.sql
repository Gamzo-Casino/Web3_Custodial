-- CreateEnum
CREATE TYPE "MinesStatus" AS ENUM ('ACTIVE', 'CASHED_OUT', 'LOST');

-- AlterEnum
ALTER TYPE "GameType" ADD VALUE 'MINES';

-- CreateTable
CREATE TABLE "MinesRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stakeGzo" DECIMAL(18,8) NOT NULL,
    "mineCount" INTEGER NOT NULL,
    "boardSize" INTEGER NOT NULL DEFAULT 25,
    "minePositions" JSONB NOT NULL,
    "revealedTiles" JSONB NOT NULL DEFAULT '[]',
    "status" "MinesStatus" NOT NULL DEFAULT 'ACTIVE',
    "multiplierPath" JSONB NOT NULL DEFAULT '[]',
    "currentMultiplier" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "grossPayoutGzo" DECIMAL(18,8),
    "profitGzo" DECIMAL(18,8),
    "feeGzo" DECIMAL(18,8),
    "netPayoutGzo" DECIMAL(18,8),
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "publicSeed" TEXT NOT NULL,
    "rngVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "MinesRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MinesRound_idempotencyKey_key" ON "MinesRound"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MinesRound_userId_idx" ON "MinesRound"("userId");

-- CreateIndex
CREATE INDEX "MinesRound_status_idx" ON "MinesRound"("status");

-- CreateIndex
CREATE INDEX "MinesRound_userId_status_idx" ON "MinesRound"("userId", "status");

-- AddForeignKey
ALTER TABLE "MinesRound" ADD CONSTRAINT "MinesRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
