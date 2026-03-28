/**
 * Shared settlement logic for all game types.
 * Currency: GZO (single currency — no conversion).
 *
 * Rule: fee applies ONLY when profit > 0 (i.e., player won).
 * Fee = WIN_FEE_RATE * profit (not of gross payout, not of pot).
 */

export const WIN_FEE_RATE = 0.1; // 10%

export interface SettlementResult {
  /** What the house would pay out before fee (e.g. 2x stake for PvP win). */
  grossPayoutGzo: number;
  /** Gross - stake. Positive = profit, negative = loss. */
  profitGzo: number;
  /** 10% of profitGzo when profitGzo > 0, else 0. */
  feeGzo: number;
  /** What the player actually receives (gross - fee). */
  netPayoutGzo: number;
}

/**
 * Compute settlement for one player's perspective.
 *
 * @param stakeGzo     Amount the player wagered.
 * @param grossPayoutGzo What the house owes before fee (0 on a loss).
 * @param feeRate      Platform fee rate (default 0.10).
 */
export function settle(
  stakeGzo: number,
  grossPayoutGzo: number,
  feeRate: number = WIN_FEE_RATE
): SettlementResult {
  const profitGzo = grossPayoutGzo - stakeGzo;
  const feeGzo = profitGzo > 0 ? Math.floor(profitGzo * feeRate) : 0;
  const netPayoutGzo = grossPayoutGzo - feeGzo;
  return { grossPayoutGzo, profitGzo, feeGzo, netPayoutGzo };
}
