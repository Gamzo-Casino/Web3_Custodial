-- AlterEnum
ALTER TYPE "GameType" ADD VALUE 'ROULETTE';

-- CreateTable
CREATE TABLE "RouletteRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wagers" JSONB NOT NULL,
    "totalStakeGzo" DECIMAL(18,8) NOT NULL,
    "winningNumber" INTEGER,
    "winningColor" TEXT,
    "grossPayoutGzo" DECIMAL(18,8),
    "profitGzo" DECIMAL(18,8),
    "feeGzo" DECIMAL(18,8),
    "netPayoutGzo" DECIMAL(18,8),
    "payoutBreakdown" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "publicSeed" TEXT NOT NULL,
    "rngVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "RouletteRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RouletteRound_idempotencyKey_key" ON "RouletteRound"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RouletteRound_userId_idx" ON "RouletteRound"("userId");

-- CreateIndex
CREATE INDEX "RouletteRound_userId_createdAt_idx" ON "RouletteRound"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "RouletteRound" ADD CONSTRAINT "RouletteRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
