/**
 * Shared settlement helper for all blackjack action routes.
 * Runs inside the caller's $transaction context.
 */

import { LedgerEntryType } from "@/lib/ledger";
import { settle } from "@/lib/settlement";
import { debitHouseTx, creditHouseTx, HouseLedgerType } from "@/lib/house";
import {
  cardFromIndex,
  compareHands,
  handGrossPayout,
  dealerPlay,
  buildGameState,
  BlackjackGameState,
  HandOutcome,
  BLACKJACK_VERSION,
} from "@/lib/blackjack";

/**
 * @param skipDealerPlay  Set true for natural-blackjack immediate resolution —
 *                        dealer keeps only the initial 2 cards (no extra draws).
 */
export async function settleTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  round: any,
  userId: string,
  skipDealerPlay = false
): Promise<BlackjackGameState> {
  const playerValues: number[]      = JSON.parse(round.playerCards as string);
  const dealerValues: number[]      = JSON.parse(round.dealerCards as string);
  const splitValues:  number[] | null = round.splitCards
    ? JSON.parse(round.splitCards as string) : null;
  const deckValues:   number[]      = JSON.parse(round.deckJson as string);

  const playerCards = playerValues.map(cardFromIndex);
  const splitCards  = splitValues ? splitValues.map(cardFromIndex) : null;

  // Dealer plays (unless skip requested e.g. for immediate natural BJ resolution)
  let dealerFinal = dealerValues;
  if (!skipDealerPlay) {
    const res = dealerPlay(dealerValues, deckValues, round.deckIndex as number);
    dealerFinal = res.finalCardValues;
  }
  const dealerCards = dealerFinal.map(cardFromIndex);

  // Determine outcomes
  const mainOutcome: HandOutcome        = compareHands(playerCards, dealerCards, false);
  const splitOutcome: HandOutcome | null = splitCards
    ? compareHands(splitCards, dealerCards, true)
    : null;

  // Payouts
  const mainStake  = Number(round.mainStakeGzo);
  const splitStake = splitCards ? Number(round.splitStakeGzo) : 0;

  const mainGross  = handGrossPayout(mainStake,  mainOutcome);
  const splitGross = splitOutcome ? handGrossPayout(splitStake, splitOutcome) : 0;
  const totalGross = mainGross + splitGross;
  const totalStake = mainStake + splitStake;

  const { profitGzo, feeGzo, netPayoutGzo } = settle(totalStake, totalGross);

  // Wallet
  const wallet = await tx.walletBalance.findUniqueOrThrow({ where: { userId } });
  const balanceBefore = Number(wallet.balance);
  let finalBalance = balanceBefore;

  if (netPayoutGzo > 0) {
    await debitHouseTx(tx, totalGross, HouseLedgerType.BET_OUT);
    if (feeGzo > 0) await creditHouseTx(tx, feeGzo, HouseLedgerType.FEE);
    finalBalance = balanceBefore + netPayoutGzo;
    await tx.walletBalance.update({ where: { userId }, data: { balance: String(finalBalance) } });
    await tx.ledgerEntry.create({
      data: {
        userId, type: LedgerEntryType.BET_WON,
        amount: String(netPayoutGzo),
        balanceBefore: String(balanceBefore),
        balanceAfter:  String(finalBalance),
        reference: null,
      },
    });
  }

  const now = new Date();
  const actionLog = JSON.parse((round.actions as string) || "[]");
  actionLog.push({ action: "settle", mainOutcome, splitOutcome, timestamp: now.toISOString() });

  // Update round
  const updatedRound = await tx.blackjackRound.update({
    where: { id: round.id },
    data: {
      status:         "SETTLED",
      mainOutcome,
      splitOutcome,
      dealerCards:    JSON.stringify(dealerFinal),
      grossPayoutGzo: String(totalGross),
      profitGzo:      String(profitGzo),
      feeGzo:         String(feeGzo),
      netPayoutGzo:   String(netPayoutGzo),
      settledAt:      now,
      actions:        JSON.stringify(actionLog),
    },
  });

  // GameBet for history
  await tx.gameBet.create({
    data: {
      userId,
      gameType:           "BLACKJACK",
      stakeGzo:           String(round.stakeGzo),
      status:             "SETTLED",
      idempotencyKey:     `blackjack-bet:${userId}:${round.nonce}`,
      serverSeedHash:     round.serverSeedHash,
      serverSeedRevealed: round.serverSeed,
      clientSeed:         round.clientSeed,
      nonce:              round.nonce,
      publicSeed:         round.publicSeed,
      referenceId:        round.id,
      settledAt:          now,
      resultJson: {
        mainOutcome,
        splitOutcome,
        playerCards:   playerValues,
        dealerCards:   dealerFinal,
        splitCards:    splitValues,
        mainStakeGzo:  mainStake,
        splitStakeGzo: splitCards ? splitStake : null,
        rngVersion:    BLACKJACK_VERSION,
      },
      grossPayoutGzo: String(totalGross),
      profitGzo:      String(profitGzo),
      feeGzo:         String(feeGzo),
      netPayoutGzo:   String(netPayoutGzo),
    },
  });

  await tx.auditLog.create({
    data: {
      userId, action: "blackjack.settle",
      entity: "BlackjackRound", entityId: round.id,
      metadata: { mainOutcome, splitOutcome, totalGross, profitGzo, feeGzo },
    },
  });

  return buildGameState(updatedRound, finalBalance);
}
