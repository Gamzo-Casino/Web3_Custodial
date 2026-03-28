// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GameMath — shared settlement math and VRF derivation for all Gamzo games
/// @notice Fee = 10% of profit only (0 on a loss or break-even)
library GameMath {
    uint256 public constant FEE_BPS   = 1000;   // 10%
    uint256 public constant BPS_DENOM = 10_000;

    // ── Settlement ────────────────────────────────────────────────────────────

    struct Settlement {
        uint256 grossPayout;  // house payout before fee
        uint256 profitAmount; // max(0, gross - stake)
        uint256 feeAmount;    // 10% of profit, 0 on loss
        uint256 netPayout;    // gross - feeAmount
    }

    /// @notice Compute settlement for a winning bet.
    function settle(uint256 stake, uint256 gross) internal pure returns (Settlement memory s) {
        s.grossPayout = gross;
        if (gross > stake) {
            s.profitAmount = gross - stake;
            s.feeAmount    = (s.profitAmount * FEE_BPS) / BPS_DENOM;
        }
        s.netPayout = gross - s.feeAmount;
    }

    // ── Dice ──────────────────────────────────────────────────────────────────

    /// @notice Gross payout for dice: floor(stake × 99 / target)
    function diceGross(uint256 stake, uint256 targetScaled) internal pure returns (uint256) {
        require(targetScaled >= 101 && targetScaled <= 9800, "invalid dice target");
        return (stake * 9900) / targetScaled;
    }

    /// @notice Map VRF word to dice roll [0, 9999]
    function vrfToDiceRoll(uint256 randomWord) internal pure returns (uint256) {
        return randomWord % 10_000;
    }

    // ── Coin Flip ─────────────────────────────────────────────────────────────

    /// @notice Map VRF word to coin flip: even = HEADS, odd = TAILS
    function vrfToCoinFlip(uint256 randomWord) internal pure returns (bool isHeads) {
        isHeads = (randomWord % 2) == 0;
    }

    // ── Limbo / Crash ─────────────────────────────────────────────────────────

    /// @notice Map VRF word to Limbo/Crash generated multiplier in [100, 1_000_000]
    ///         (divide by 100 for display: 100 = 1.00×, 200 = 2.00×, 1_000_000 = 10000×)
    ///         Uses Pareto inverse-CDF; ~3% of outcomes bust at 1.00×.
    function vrfToLimboMultiplier(uint256 randomWord) internal pure returns (uint256) {
        uint256 u = randomWord % 1_000_000;
        if (u >= 997_000) return 100;
        uint256 mult = (9_900 * 1_000_000) / (1_000_000 - u);
        if (mult < 100) mult = 100;
        if (mult > 1_000_000) mult = 1_000_000;
        return mult;
    }

    function vrfToCrashPoint(uint256 randomWord) internal pure returns (uint256) {
        return vrfToLimboMultiplier(randomWord);
    }

    /// @notice Gross payout for Limbo/Crash on win: stake × targetBps / 100
    ///         targetBps: 100 = 1.00×, 200 = 2.00×, max 1_000_000 = 10000×
    function limboGross(uint256 stake, uint256 targetBps) internal pure returns (uint256) {
        return (stake * targetBps) / 100;
    }

    // ── Wheel ─────────────────────────────────────────────────────────────────

    /// @notice Map VRF word to a wheel stop position [0, totalWeight)
    function vrfToWheelStop(uint256 randomWord, uint256 totalWeight) internal pure returns (uint256) {
        return randomWord % totalWeight;
    }

    // ── Roulette ─────────────────────────────────────────────────────────────

    /// @notice Map VRF word to roulette number [0, 36] (European wheel)
    function vrfToRouletteNumber(uint256 randomWord) internal pure returns (uint256) {
        return randomWord % 37;
    }

    // ── Plinko ────────────────────────────────────────────────────────────────

    /// @notice Derive Plinko ball path bits from VRF word.
    ///         Bit i of randomWord = direction at row i (0=left, 1=right).
    ///         Supports up to 32 rows.
    function vrfToPlinkoPath(uint256 randomWord, uint256 rows) internal pure returns (uint256 bits) {
        // Use low `rows` bits of the VRF word
        uint256 mask = (1 << rows) - 1;
        bits = randomWord & mask;
    }

    /// @notice Count right-steps in path to get bin index [0, rows]
    function plinkoBinFromPath(uint256 pathBits, uint256 rows) internal pure returns (uint256 bin) {
        for (uint256 i = 0; i < rows; i++) {
            bin += (pathBits >> i) & 1;
        }
    }

    /// @notice Look up Plinko multiplier in ×100 units (100 = 1.00×, 560 = 5.60×)
    ///         rows: 8, 12, or 16; risk: 0=low, 1=med, 2=high; bin: [0, rows]
    function plinkoMultiplier100(uint8 rows, uint8 risk, uint256 bin)
        internal pure returns (uint256)
    {
        // 8-row tables (9 bins)
        if (rows == 8) {
            uint256[9][3] memory t = [
                [uint256(560),210,110,100,50,100,110,210,560],   // low
                [uint256(1300),300,130,70,40,70,130,300,1300],   // med
                [uint256(2900),400,150,30,20,30,150,400,2900]    // high
            ];
            return t[risk][bin];
        }
        // 12-row tables (13 bins)
        if (rows == 12) {
            uint256[13][3] memory t = [
                [uint256(890),300,140,110,100,50,30,50,100,110,140,300,890],
                [uint256(3300),1100,400,200,60,30,20,30,60,200,400,1100,3300],
                [uint256(17000),2400,810,200,70,20,20,20,70,200,810,2400,17000]
            ];
            return t[risk][bin];
        }
        // 16-row tables (17 bins)
        if (rows == 16) {
            uint256[17][3] memory t = [
                [uint256(1600),900,200,140,140,120,110,100,50,100,110,120,140,140,200,900,1600],
                [uint256(11000),4100,1000,500,300,150,100,50,30,50,100,150,300,500,1000,4100,11000],
                [uint256(100000),13000,2600,900,400,200,20,20,20,20,20,200,400,900,2600,13000,100000]
            ];
            return t[risk][bin];
        }
        return 100; // fallback 1.00×
    }

    // ── Keno ──────────────────────────────────────────────────────────────────

    /// @notice Derive Keno draw: 10 unique numbers from [1..40] via Fisher-Yates.
    ///         Uses keccak256(seed, step) expansion for determinism.
    function vrfToKenoNumbers(uint256 seed)
        internal pure returns (uint8[10] memory drawn)
    {
        uint8[40] memory pool;
        for (uint8 i = 0; i < 40; i++) pool[i] = i + 1;

        for (uint8 i = 39; i > 0; i--) {
            uint8 j = uint8(uint256(keccak256(abi.encodePacked(seed, i))) % (i + 1));
            (pool[i], pool[j]) = (pool[j], pool[i]);
        }
        for (uint8 k = 0; k < 10; k++) drawn[k] = pool[k];
    }

    /// @notice Count matches between player picks and drawn numbers.
    ///         picks is a packed bytes array of pick values [1..40].
    function kenoMatchCount(uint8[] memory picks, uint8[10] memory drawn)
        internal pure returns (uint256 matches)
    {
        bool[41] memory drawnSet;
        for (uint8 i = 0; i < 10; i++) drawnSet[drawn[i]] = true;
        for (uint256 i = 0; i < picks.length; i++) {
            if (drawnSet[picks[i]]) matches++;
        }
    }

    /// @notice Look up Keno payout multiplier in ×100 units (350 = 3.50×, 0 = loss)
    function kenoPayoutMultiplier100(uint256 pickCount, uint256 matchCount)
        internal pure returns (uint256)
    {
        // Paytable: [picks][matchCount] = multiplier ×100
        // Row 0 unused; rows 1-10 = pick counts 1-10
        if (pickCount == 1) {
            uint256[2] memory t = [uint256(0), 350]; return t[matchCount < 2 ? matchCount : 1];
        }
        if (pickCount == 2) {
            uint256[3] memory t = [uint256(0), 100, 700]; return matchCount < 3 ? t[matchCount] : 700;
        }
        if (pickCount == 3) {
            uint256[4] memory t = [uint256(0), 100, 300, 2100]; return matchCount < 4 ? t[matchCount] : 2100;
        }
        if (pickCount == 4) {
            uint256[5] memory t = [uint256(0), 0, 200, 500, 5500]; return matchCount < 5 ? t[matchCount] : 5500;
        }
        if (pickCount == 5) {
            uint256[6] memory t = [uint256(0), 0, 150, 400, 2000, 10000]; return matchCount < 6 ? t[matchCount] : 10000;
        }
        if (pickCount == 6) {
            uint256[7] memory t = [uint256(0), 0, 100, 200, 1000, 5000, 50000]; return matchCount < 7 ? t[matchCount] : 50000;
        }
        if (pickCount == 7) {
            uint256[8] memory t = [uint256(0), 0, 0, 150, 500, 2000, 10000, 100000]; return matchCount < 8 ? t[matchCount] : 100000;
        }
        if (pickCount == 8) {
            uint256[9] memory t = [uint256(0), 0, 0, 100, 300, 1000, 5000, 25000, 200000]; return matchCount < 9 ? t[matchCount] : 200000;
        }
        if (pickCount == 9) {
            uint256[10] memory t = [uint256(0), 0, 0, 100, 200, 600, 3000, 10000, 50000, 500000]; return matchCount < 10 ? t[matchCount] : 500000;
        }
        if (pickCount == 10) {
            uint256[11] memory t = [uint256(500), 0, 0, 100, 200, 500, 2000, 10000, 50000, 200000, 1000000];
            return matchCount < 11 ? t[matchCount] : 1000000;
        }
        return 0;
    }

    // ── Mines ─────────────────────────────────────────────────────────────────

    /// @notice Compute Mines multiplier in ×100 units using exact combinatorial formula:
    ///         C(boardSize, safePicks) / C(boardSize - mineCount, safePicks) × 100
    ///         boardSize = 25 for standard 5×5 board.
    function minesMultiplier100(
        uint256 boardSize,
        uint256 mineCount,
        uint256 safePicks
    ) internal pure returns (uint256) {
        if (safePicks == 0) return 100; // 1.00×
        uint256 safeTotal = boardSize - mineCount;
        if (safePicks > safeTotal) return 0;

        // Compute ratio iteratively to avoid overflow: C(n,k) / C(m,k)
        // = product_{i=0}^{k-1} (n-i) / (m-i)
        uint256 num = 1;
        uint256 den = 1;
        for (uint256 i = 0; i < safePicks; i++) {
            num = num * (boardSize - i);
            den = den * (safeTotal  - i);
            // Simplify to prevent overflow
            uint256 g = _gcd(num, den);
            num /= g;
            den /= g;
        }
        return (num * 100) / den;
    }

    function _gcd(uint256 a, uint256 b) private pure returns (uint256) {
        while (b != 0) { (a, b) = (b, a % b); }
        return a;
    }

    // ── Blackjack helpers ─────────────────────────────────────────────────────

    /// @notice Get rank (0-12) from card index (0-51): Ace=0, 2-10=1-9, J=10, Q=11, K=12
    function cardRank(uint8 card) internal pure returns (uint8) {
        return card % 13;
    }

    /// @notice Get hard point value of a single card (Ace = 1 in hard mode)
    function cardHardValue(uint8 card) internal pure returns (uint256) {
        uint8 rank = cardRank(card);
        if (rank == 0) return 1;          // Ace counted low in hard value
        if (rank >= 10) return 10;         // J, Q, K
        return rank + 1;                   // 2-10
    }

    /// @notice Compute best blackjack hand total from card array.
    ///         Returns (value, isSoft) where isSoft means at least one Ace is counted as 11.
    function blackjackHandValue(uint8[] memory cards)
        internal pure returns (uint256 val, bool soft)
    {
        uint256 aces = 0;
        for (uint256 i = 0; i < cards.length; i++) {
            uint8 rank = cardRank(cards[i]);
            if (rank == 0) {
                aces++;
                val += 11;
            } else if (rank >= 10) {
                val += 10;
            } else {
                val += rank + 1;
            }
        }
        while (val > 21 && aces > 0) {
            val  -= 10;
            aces--;
        }
        soft = (aces > 0 && val <= 21);
    }

    // ── Hilo helpers ──────────────────────────────────────────────────────────

    /// @notice Hilo guess payout multiplier in ×100 units for a correct guess.
    ///         rank: 0=Ace, 1-8=2-9, 9=10, 10=J, 11=Q, 12=K
    ///         guess: 0=HIGHER, 1=LOWER, 2=SAME
    function hiloMultiplierStep100(uint8 rank, uint8 guess)
        internal pure returns (uint256)
    {
        // Number of cards strictly higher, lower, or equal in a 52-card deck
        // Higher = ranks above current; 4 cards per rank; Ace is rank 0
        // Treat Ace-high (rank 0 = Ace = highest) for standard Hi-Lo
        // Card ranks for Hi-Lo: A(13)>K(12)>Q(11)>J(10)>10(9)>9(8)>...>2(1)
        uint8 hiloRank = rank == 0 ? 13 : rank; // Ace = 13 (high)
        uint256 higher = hiloRank < 13 ? uint256(13 - hiloRank) * 4 : 0;
        uint256 lower  = hiloRank > 1  ? uint256(hiloRank - 1)  * 4 : 0;
        uint256 equal  = 4; // same rank, different suits (3 remaining)
        if (guess == 0) { // HIGHER
            if (higher == 0) return 0; // impossible
            return (5200) / higher; // ×100 scaled: 52 total × 100 / higher_count
        }
        if (guess == 1) { // LOWER
            if (lower == 0) return 0;
            return (5200) / lower;
        }
        // SAME
        return (5200) / equal; // = 1300 for 4 equal cards
    }
}
