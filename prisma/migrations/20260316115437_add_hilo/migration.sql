-- AlterEnum
ALTER TYPE "GameType" ADD VALUE 'HILO';

-- CreateTable
CREATE TABLE "HiloRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stakeGzo" DECIMAL(18,8) NOT NULL,
    "deckJson" JSONB NOT NULL,
    "deckIndex" INTEGER NOT NULL DEFAULT 1,
    "currentMultiplier" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "guessHistory" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
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

    CONSTRAINT "HiloRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HiloRound_idempotencyKey_key" ON "HiloRound"("idempotencyKey");

-- CreateIndex
CREATE INDEX "HiloRound_userId_idx" ON "HiloRound"("userId");

-- CreateIndex
CREATE INDEX "HiloRound_userId_status_idx" ON "HiloRound"("userId", "status");

-- CreateIndex
CREATE INDEX "HiloRound_userId_createdAt_idx" ON "HiloRound"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "HiloRound" ADD CONSTRAINT "HiloRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
