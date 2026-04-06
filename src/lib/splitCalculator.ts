import { SplitType, type User } from '@prisma/client';

import type { Participant, Payer, SplitShares } from '~/store/addStore';
import { shuffleArray } from '~/utils/array';
import { BigMath } from '~/utils/numbers';
import { cyrb128, splitmix32 } from '~/utils/random';

/**
 * Unified split calculation utility. Provides both the forward
 * (shares → per-participant amounts) and inverse (per-participant amounts
 * → shares) transforms, sharing a single per-SplitType handler map so that
 * the six SplitType branches are only maintained in one place.
 *
 * The thin wrappers `calculateParticipantSplit` and
 * `calculateSplitShareBasedOnAmount` exported from `~/store/addStore` delegate
 * to the functions in this module and exist only to preserve the store's
 * public API for existing consumers.
 */

export interface ForwardSplitInput {
  amount: bigint;
  participants: Participant[];
  splitType: SplitType;
  splitShares: SplitShares;
  paidBy?: User;
  payers?: Payer[];
  expenseDate: Date;
}

export interface ForwardSplitResult {
  participants: Participant[];
  canSplitScreenClosed: boolean;
}

export interface InverseSplitInput {
  amount: bigint;
  participants: Participant[];
  splitType: SplitType;
  splitShares: SplitShares;
  paidBy?: User;
  payers?: Payer[];
}

interface ForwardContext {
  amount: bigint;
  participants: Participant[];
  splitShares: SplitShares;
  getSplitShare: (p: Participant) => bigint | undefined;
}

interface ForwardHandlerResult {
  /** Per-participant share (amount owed), parallel to `participants`. */
  shares: bigint[];
  canSplitScreenClosed: boolean;
}

interface InverseContext {
  amount: bigint;
  participants: Participant[];
  splitShares: SplitShares;
  splitType: SplitType;
  payerMap: Map<number, bigint>;
}

interface SplitHandler {
  forward: (ctx: ForwardContext) => ForwardHandlerResult;
  inverse: (ctx: InverseContext) => void;
}

const buildPayerMap = (
  amount: bigint,
  paidBy: User | undefined,
  payers: Payer[] | undefined,
): Map<number, bigint> => {
  const payerMap = new Map<number, bigint>();
  if (payers && payers.length > 0) {
    for (const p of payers) {
      payerMap.set(p.user.id, p.amount);
    }
  } else if (paidBy) {
    payerMap.set(paidBy.id, amount);
  }
  return payerMap;
};

const getOwedWithPayer =
  (payerMap: Map<number, bigint>) =>
  (p: Participant): bigint => {
    const paidAmount = payerMap.get(p.id) ?? 0n;
    return BigMath.abs((p.amount ?? 0n) - paidAmount);
  };

/**
 * SETTLEMENT has no per-type transform in either direction. Forward passes
 * the participants' existing `amount` through as the "share" so the downstream
 * payer overlay produces `-(amount) + paidAmount`, matching the historical
 * behavior of the switch-with-no-SETTLEMENT-case.
 */
const noopHandler: SplitHandler = {
  forward: ({ participants }) => ({
    shares: participants.map((p) => p.amount ?? 0n),
    canSplitScreenClosed: true,
  }),
  inverse: () => {
    // Intentional no-op.
  },
};

const handlers: Record<SplitType, SplitHandler> = {
  [SplitType.EQUAL]: {
    forward: ({ amount, participants, splitShares, getSplitShare }) => {
      const getWeight = (p: Participant): bigint => {
        const share = getSplitShare(p);
        if (undefined === share) {
          return 1n;
        }
        return share;
      };
      const totalWeight = participants.reduce((acc, p) => acc + getWeight(p), 0n);
      const shares = participants.map((p) => {
        const weight = getWeight(p);
        return 0n === weight ? 0n : (amount * weight) / totalWeight;
      });
      const canSplitScreenClosed = Boolean(
        Object.values(splitShares).find((p) => 0n !== p[SplitType.EQUAL]),
      );
      return { shares, canSplitScreenClosed };
    },
    inverse: ({ participants, splitShares, splitType, payerMap }) => {
      participants.forEach((p) => {
        const paidAmount = payerMap.get(p.id) ?? 0n;
        splitShares[p.id]![splitType] =
          paidAmount === p.amount && participants.length > 1 ? 0n : 1n;
      });
    },
  },

  [SplitType.PERCENTAGE]: {
    forward: ({ amount, participants, getSplitShare }) => {
      const shares = participants.map((p) => ((getSplitShare(p) ?? 0n) * amount) / 10000n);
      const canSplitScreenClosed =
        0 === 100 - participants.reduce((acc, p) => acc + Number(getSplitShare(p) ?? 0n) / 100, 0);
      return { shares, canSplitScreenClosed };
    },
    inverse: ({ amount, participants, splitShares, splitType, payerMap }) => {
      const getOwed = getOwedWithPayer(payerMap);
      participants.forEach((p) => {
        splitShares[p.id]![splitType] = 0n === amount ? 0n : (getOwed(p) * 10000n) / amount;
      });
    },
  },

  [SplitType.SHARE]: {
    forward: ({ amount, participants, getSplitShare }) => {
      const totalShare = participants.reduce((acc, p) => acc + Number(getSplitShare(p) ?? 0n), 0);
      const canSplitScreenClosed = 0 < totalShare;
      const shares = participants.map((p) =>
        0n === (getSplitShare(p) ?? 0n)
          ? 0n
          : ((getSplitShare(p) ?? 0n) * amount) / BigInt(Math.round(totalShare)),
      );
      return { shares, canSplitScreenClosed };
    },
    inverse: ({ amount, participants, splitShares, splitType, payerMap }) => {
      const getOwed = getOwedWithPayer(payerMap);
      const amounts = participants
        .filter(({ amount: partAmount }) => Boolean(partAmount))
        .map((p) => getOwed(p))
        .filter((s) => s !== 0n);

      const gcdValue = amounts.length > 1 ? amounts.reduce((a, b) => BigMath.gcd(a, b)) : 1n;

      participants.forEach((p) => {
        splitShares[p.id]![splitType] = 0n === amount ? 0n : (getOwed(p) * 100n) / gcdValue;
      });
    },
  },

  [SplitType.EXACT]: {
    forward: ({ amount, participants, getSplitShare }) => {
      const totalSplitShare = participants.reduce((acc, p) => acc + (getSplitShare(p) ?? 0n), 0n);
      const canSplitScreenClosed = amount === totalSplitShare;
      // Undefined shares coerce to 0n (matching the old pass-through behavior).
      const shares = participants.map((p) => getSplitShare(p) ?? 0n);
      return { shares, canSplitScreenClosed };
    },
    inverse: ({ participants, splitShares, splitType, payerMap }) => {
      const getOwed = getOwedWithPayer(payerMap);
      participants.forEach((p) => {
        splitShares[p.id]![splitType] = getOwed(p);
      });
    },
  },

  [SplitType.ADJUSTMENT]: {
    forward: ({ amount, participants, getSplitShare }) => {
      const totalAdjustment = participants.reduce((acc, p) => acc + (getSplitShare(p) ?? 0n), 0n);
      const canSplitScreenClosed = !(totalAdjustment > amount);
      const remainingAmountShare = (amount - totalAdjustment) / BigInt(participants.length);
      const shares = participants.map((p) => remainingAmountShare + (getSplitShare(p) ?? 0n));
      return { shares, canSplitScreenClosed };
    },
    inverse: ({ amount, participants, splitShares, splitType, payerMap }) => {
      const getOwed = getOwedWithPayer(payerMap);
      // Legacy two-formula semantics: the minAmount uses |p.amount - paidAmount|,
      // But the final share for a payer uses `amount - |p.amount|`. This matches
      // The pre-multi-payer behavior (restored by 1c69de2).
      const getAdjustmentShare = (p: Participant): bigint => {
        const paidAmount = payerMap.get(p.id) ?? 0n;
        if (paidAmount > 0n) {
          return amount - BigMath.abs(p.amount ?? 0n);
        }
        return BigMath.abs(p.amount ?? 0n);
      };
      const shareAmounts = participants
        .filter(({ amount: partAmount }) => 0n !== partAmount)
        .map((p) => getOwed(p));
      const minAmount = shareAmounts.length > 0 ? BigMath.min(...shareAmounts) : 0n;
      participants.forEach((p) => {
        splitShares[p.id]![splitType] = getAdjustmentShare(p) - minAmount;
      });
    },
  },

  [SplitType.SETTLEMENT]: noopHandler,
  [SplitType.CURRENCY_CONVERSION]: noopHandler,
};

/**
 * Forward split: compute each participant's net position given the amount,
 * split shares, payers, and split type. Handles all six SplitType branches
 * via the shared handler map.
 */
export const calculateForwardSplit = (input: ForwardSplitInput): ForwardSplitResult => {
  const { amount, participants, splitType, splitShares, paidBy, payers, expenseDate } = input;

  if (0n === amount) {
    return { participants, canSplitScreenClosed: true };
  }

  const getSplitShare = (p: Participant) => splitShares[p.id]?.[splitType];

  const handler = handlers[splitType] ?? noopHandler;
  const { shares, canSplitScreenClosed } = handler.forward({
    amount,
    participants,
    splitShares,
    getSplitShare,
  });

  // Apply payer overlay: net = paidAmount - share.
  const payerMap = buildPayerMap(amount, paidBy, payers);
  const updatedParticipants = participants.map((p, i) => ({
    ...p,
    amount: -(shares[i] ?? 0n) + (payerMap.get(p.id) ?? 0n),
  }));

  if (canSplitScreenClosed) {
    let penniesLeft = updatedParticipants.reduce((acc, p) => acc + (p.amount ?? 0n), 0n);
    const participantsToPick = updatedParticipants.filter((p) => p.amount);
    const seed =
      cyrb128(
        `${participantsToPick
          .map((p) => p.amount)
          .toSorted((a, b) => Number((a ?? 0n) - (b ?? 0n)))
          .join('-')}-${new Intl.DateTimeFormat('en').format(expenseDate)}`,
      )[0] ?? 0;
    const random = splitmix32(seed);

    if (0 < participantsToPick.length) {
      shuffleArray(participantsToPick, random);
      let i = 0;
      while (0n !== penniesLeft) {
        const p = participantsToPick[i % participantsToPick.length]!;
        p.amount -= BigMath.sign(penniesLeft);
        penniesLeft -= BigMath.sign(penniesLeft);
        i++;
      }
    }
  }

  return { participants: updatedParticipants, canSplitScreenClosed };
};

/**
 * Inverse split: given each participant's net position (in `participants`),
 * recover the per-type split shares and write them into `splitShares` in
 * place.
 */
export const calculateInverseSplit = (input: InverseSplitInput): void => {
  const { amount, participants, splitType, splitShares, paidBy, payers } = input;
  const payerMap = buildPayerMap(amount, paidBy, payers);
  const handler = handlers[splitType] ?? noopHandler;
  handler.inverse({ amount, participants, splitShares, splitType, payerMap });
};
