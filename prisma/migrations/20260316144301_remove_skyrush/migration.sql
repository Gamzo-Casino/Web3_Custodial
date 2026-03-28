/*
  Warnings:

  - You are about to drop the `SkyRushBet` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SkyRushRound` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "SkyRushBet" DROP CONSTRAINT "SkyRushBet_roundId_fkey";

-- DropForeignKey
ALTER TABLE "SkyRushBet" DROP CONSTRAINT "SkyRushBet_userId_fkey";

-- DropTable
DROP TABLE "SkyRushBet";

-- DropTable
DROP TABLE "SkyRushRound";

-- DropEnum
DROP TYPE "SkyRushBetStatus";

-- DropEnum
DROP TYPE "SkyRushRoundStatus";
