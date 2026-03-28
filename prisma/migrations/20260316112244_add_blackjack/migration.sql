-- AlterEnum
ALTER TYPE "GameType" ADD VALUE 'BLACKJACK';

-- CreateTable
CREATE TABLE "BlackjackRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stakeGzo" DECIMAL(18,8) NOT NULL,
    "deckJson" JSONB NOT NULL,
    "deckIndex" INTEGER NOT NULL DEFAULT 4,
    "playerCards" JSONB NOT NULL,
    "dealerCards" JSONB NOT NULL,
    "splitCards" JSONB,
    "activeHand" INTEGER NOT NULL DEFAULT 0,
    "mainStakeGzo" DECIMAL(18,8) NOT NULL,
    "splitStakeGzo" DECIMAL(18,8),
    "mainDoubled" BOOLEAN NOT NULL DEFAULT false,
    "splitDoubled" BOOLEAN NOT NULL DEFAULT false,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "mainOutcome" TEXT,
    "splitOutcome" TEXT,
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

    CONSTRAINT "BlackjackRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlackjackRound_idempotencyKey_key" ON "BlackjackRound"("idempotencyKey");

-- CreateIndex
CREATE INDEX "BlackjackRound_userId_idx" ON "BlackjackRound"("userId");

-- CreateIndex
CREATE INDEX "BlackjackRound_userId_status_idx" ON "BlackjackRound"("userId", "status");

-- CreateIndex
CREATE INDEX "BlackjackRound_userId_createdAt_idx" ON "BlackjackRound"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "BlackjackRound" ADD CONSTRAINT "BlackjackRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
