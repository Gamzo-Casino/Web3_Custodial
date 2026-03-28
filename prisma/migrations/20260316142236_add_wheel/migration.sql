-- AlterEnum
ALTER TYPE "GameType" ADD VALUE 'WHEEL';

-- CreateTable
CREATE TABLE "WheelRound" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stakeGzo" DECIMAL(18,8) NOT NULL,
    "riskMode" TEXT NOT NULL,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "stopPosition" INTEGER NOT NULL,
    "segmentIndex" INTEGER NOT NULL,
    "segmentLabel" TEXT NOT NULL,
    "landedMultiplier" DECIMAL(18,8) NOT NULL,
    "grossPayoutGzo" DECIMAL(18,8) NOT NULL,
    "profitGzo" DECIMAL(18,8) NOT NULL,
    "feeGzo" DECIMAL(18,8) NOT NULL,
    "netPayoutGzo" DECIMAL(18,8) NOT NULL,
    "serverSeed" TEXT NOT NULL,
    "serverSeedHash" TEXT NOT NULL,
    "clientSeed" TEXT NOT NULL,
    "nonce" INTEGER NOT NULL,
    "publicSeed" TEXT NOT NULL,
    "rngVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "WheelRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WheelRound_idempotencyKey_key" ON "WheelRound"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WheelRound_userId_idx" ON "WheelRound"("userId");

-- CreateIndex
CREATE INDEX "WheelRound_userId_createdAt_idx" ON "WheelRound"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "WheelRound" ADD CONSTRAINT "WheelRound_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
