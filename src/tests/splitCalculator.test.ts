import { SplitType, type User } from '@prisma/client';

import {
  type ForwardSplitInput,
  type InverseSplitInput,
  calculateForwardSplit,
  calculateInverseSplit,
} from '~/lib/splitCalculator';
import { type Participant, type Payer, initSplitShares } from '~/store/addStore';

// Disable the shuffle inside the penny-adjustment loop so that results stay deterministic.
jest.mock('~/utils/array', () => ({
  shuffleArray: jest.fn(<T>(arr: T[]): T[] => arr),
}));

const createMockUser = (id: number, name: string): User => ({
  id,
  name,
  email: `${name.toLowerCase()}@example.com`,
  currency: 'USD',
  emailVerified: null,
  image: null,
  passwordHash: null,
  preferredLanguage: 'en',
  obapiProviderId: null,
  bankingId: null,
  hiddenFriendIds: [],
});

const user1 = createMockUser(1, 'Alice');
const user2 = createMockUser(2, 'Bob');
const user3 = createMockUser(3, 'Charlie');

const makeParticipants = (users: User[], amounts: bigint[] = []): Participant[] =>
  users.map((user, idx) => ({ ...user, amount: amounts[idx] ?? 0n }));

const makeSplitShares = (
  participants: Participant[],
  splitType: SplitType,
  shares: (bigint | undefined)[],
) => {
  const result: Record<number, Record<SplitType, bigint | undefined>> = {};
  participants.forEach((p, idx) => {
    result[p.id] = initSplitShares();
    result[p.id]![splitType] = shares[idx];
  });
  return result;
};

const initSplitSharesFor = (participants: Participant[]) => {
  const result: Record<number, Record<SplitType, bigint | undefined>> = {};
  participants.forEach((p) => {
    result[p.id] = initSplitShares();
  });
  return result;
};

const forwardInput = (overrides: Partial<ForwardSplitInput>): ForwardSplitInput => ({
  amount: 0n,
  participants: [],
  splitType: SplitType.EQUAL,
  splitShares: {},
  paidBy: undefined,
  payers: undefined,
  expenseDate: new Date('2024-01-01'),
  ...overrides,
});

const inverseInput = (overrides: Partial<InverseSplitInput>): InverseSplitInput => ({
  amount: 0n,
  participants: [],
  splitType: SplitType.EQUAL,
  splitShares: {},
  paidBy: undefined,
  payers: undefined,
  ...overrides,
});

describe('calculateForwardSplit', () => {
  describe('Short-circuit cases', () => {
    it('returns participants unchanged when amount is 0', () => {
      const participants = makeParticipants([user1, user2]);
      const splitShares = makeSplitShares(participants, SplitType.EQUAL, [1n, 1n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 0n,
          participants,
          splitShares,
          paidBy: user1,
        }),
      );

      expect(result.participants).toBe(participants);
      expect(result.canSplitScreenClosed).toBe(true);
    });
  });

  describe('SplitType.EQUAL', () => {
    it('splits evenly with single payer', () => {
      const participants = makeParticipants([user1, user2, user3]);
      const splitShares = makeSplitShares(participants, SplitType.EQUAL, [1n, 1n, 1n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 30000n,
          participants,
          splitShares,
          paidBy: user1,
        }),
      );

      expect(result.participants[0]?.amount).toBe(20000n); // Payer: -10000 + 30000
      expect(result.participants[1]?.amount).toBe(-10000n);
      expect(result.participants[2]?.amount).toBe(-10000n);
      expect(result.canSplitScreenClosed).toBe(true);
    });

    it('weights by share when weights differ', () => {
      const participants = makeParticipants([user1, user2, user3]);
      // Custom weights 2:1:1
      const splitShares = makeSplitShares(participants, SplitType.EQUAL, [2n, 1n, 1n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 40000n,
          participants,
          splitShares,
          paidBy: user1,
        }),
      );

      // Weighted owed: 20000, 10000, 10000
      expect(result.participants[0]?.amount).toBe(20000n); // -20000 + 40000
      expect(result.participants[1]?.amount).toBe(-10000n);
      expect(result.participants[2]?.amount).toBe(-10000n);
    });

    it('excludes participants with weight 0', () => {
      const participants = makeParticipants([user1, user2, user3]);
      const splitShares = makeSplitShares(participants, SplitType.EQUAL, [1n, 1n, 0n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 10000n,
          participants,
          splitShares,
          paidBy: user1,
        }),
      );

      expect(result.participants[0]?.amount).toBe(5000n); // -5000 + 10000
      expect(result.participants[1]?.amount).toBe(-5000n);
      expect(result.participants[2]?.amount).toBe(0n); // Excluded
    });

    it('marks incomplete when every EQUAL share is 0', () => {
      const participants = makeParticipants([user1, user2]);
      const splitShares = makeSplitShares(participants, SplitType.EQUAL, [0n, 0n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 10000n,
          participants,
          splitShares,
          paidBy: user1,
        }),
      );

      expect(result.canSplitScreenClosed).toBe(false);
    });
  });

  describe('SplitType.PERCENTAGE', () => {
    it('distributes by percentage basis points', () => {
      const participants = makeParticipants([user1, user2, user3]);
      // 50%, 30%, 20% — stored as basis points * 100 (i.e. x/10000)
      const splitShares = makeSplitShares(participants, SplitType.PERCENTAGE, [
        5000n,
        3000n,
        2000n,
      ]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 10000n,
          participants,
          splitType: SplitType.PERCENTAGE,
          splitShares,
          paidBy: user1,
        }),
      );

      expect(result.participants[0]?.amount).toBe(5000n); // -5000 + 10000
      expect(result.participants[1]?.amount).toBe(-3000n);
      expect(result.participants[2]?.amount).toBe(-2000n);
      expect(result.canSplitScreenClosed).toBe(true);
    });

    it('marks incomplete when percentages do not sum to 100', () => {
      const participants = makeParticipants([user1, user2]);
      const splitShares = makeSplitShares(participants, SplitType.PERCENTAGE, [3000n, 5000n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 10000n,
          participants,
          splitType: SplitType.PERCENTAGE,
          splitShares,
          paidBy: user1,
        }),
      );

      expect(result.canSplitScreenClosed).toBe(false);
    });
  });

  describe('SplitType.SHARE', () => {
    it('splits proportionally by shares', () => {
      const participants = makeParticipants([user1, user2, user3]);
      const splitShares = makeSplitShares(participants, SplitType.SHARE, [2n, 1n, 1n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 12000n,
          participants,
          splitType: SplitType.SHARE,
          splitShares,
          paidBy: user1,
        }),
      );

      // Ratio 2:1:1 of 12000 → 6000, 3000, 3000
      expect(result.participants[0]?.amount).toBe(6000n); // -6000 + 12000
      expect(result.participants[1]?.amount).toBe(-3000n);
      expect(result.participants[2]?.amount).toBe(-3000n);
    });

    it('marks incomplete when total share is 0', () => {
      const participants = makeParticipants([user1, user2]);
      const splitShares = makeSplitShares(participants, SplitType.SHARE, [0n, 0n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 10000n,
          participants,
          splitType: SplitType.SHARE,
          splitShares,
          paidBy: user1,
        }),
      );

      expect(result.canSplitScreenClosed).toBe(false);
    });
  });

  describe('SplitType.EXACT', () => {
    it('uses share as absolute amount owed', () => {
      const participants = makeParticipants([user1, user2, user3]);
      const splitShares = makeSplitShares(participants, SplitType.EXACT, [4000n, 3500n, 2500n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 10000n,
          participants,
          splitType: SplitType.EXACT,
          splitShares,
          paidBy: user1,
        }),
      );

      expect(result.participants[0]?.amount).toBe(6000n); // -4000 + 10000
      expect(result.participants[1]?.amount).toBe(-3500n);
      expect(result.participants[2]?.amount).toBe(-2500n);
      expect(result.canSplitScreenClosed).toBe(true);
    });

    it('marks incomplete when exacts do not sum to total', () => {
      const participants = makeParticipants([user1, user2]);
      const splitShares = makeSplitShares(participants, SplitType.EXACT, [4000n, 3000n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 10000n,
          participants,
          splitType: SplitType.EXACT,
          splitShares,
          paidBy: user1,
        }),
      );

      expect(result.canSplitScreenClosed).toBe(false);
    });
  });

  describe('SplitType.ADJUSTMENT', () => {
    it('distributes the remainder equally after per-participant adjustments', () => {
      const participants = makeParticipants([user1, user2, user3]);
      const splitShares = makeSplitShares(participants, SplitType.ADJUSTMENT, [1500n, 0n, 0n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 7500n,
          participants,
          splitType: SplitType.ADJUSTMENT,
          splitShares,
          paidBy: user1,
        }),
      );

      // Remaining share = (7500 - 1500) / 3 = 2000; owed: user1 = 3500; user2,3 = 2000
      expect(result.participants[0]?.amount).toBe(4000n); // -3500 + 7500
      expect(result.participants[1]?.amount).toBe(-2000n);
      expect(result.participants[2]?.amount).toBe(-2000n);
      expect(result.canSplitScreenClosed).toBe(true);
    });

    it('marks incomplete when adjustments exceed amount', () => {
      const participants = makeParticipants([user1, user2]);
      const splitShares = makeSplitShares(participants, SplitType.ADJUSTMENT, [8000n, 5000n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 10000n,
          participants,
          splitType: SplitType.ADJUSTMENT,
          splitShares,
          paidBy: user1,
        }),
      );

      expect(result.canSplitScreenClosed).toBe(false);
    });
  });

  describe('SplitType.SETTLEMENT', () => {
    it('flips preset participant amounts via the payer overlay', () => {
      // SETTLEMENT has no per-type transform: each participant's pre-set amount
      // Is treated as their "share", then the payer overlay nets it.
      const participants = makeParticipants([user1, user2], [5000n, 0n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 5000n,
          participants,
          splitType: SplitType.SETTLEMENT,
          splitShares: {},
          paidBy: user1,
        }),
      );

      // User1: share=5000 paid=5000 → net 0; user2: share=0 paid=0 → net 0.
      expect(result.participants[0]?.amount).toBe(0n);
      expect(result.participants[1]?.amount).toBe(0n);
    });
  });

  describe('Multi-payer support', () => {
    it('uses the payers array when provided', () => {
      const participants = makeParticipants([user1, user2, user3]);
      const splitShares = makeSplitShares(participants, SplitType.EQUAL, [1n, 1n, 1n]);
      const payers: Payer[] = [
        { user: user1, amount: 6000n },
        { user: user2, amount: 3000n },
      ];

      const result = calculateForwardSplit(
        forwardInput({
          amount: 9000n,
          participants,
          splitType: SplitType.EQUAL,
          splitShares,
          paidBy: user1,
          payers,
        }),
      );

      // Owed per participant: 3000. user1: -3000+6000=3000; user2: -3000+3000=0; user3: -3000+0=-3000.
      expect(result.participants[0]?.amount).toBe(3000n);
      expect(result.participants[1]?.amount).toBe(0n);
      expect(result.participants[2]?.amount).toBe(-3000n);
      // Total sums to 0
      const total = result.participants.reduce((acc, p) => acc + (p.amount ?? 0n), 0n);
      expect(total).toBe(0n);
    });

    it('falls back to paidBy when payers is empty', () => {
      const participants = makeParticipants([user1, user2]);
      const splitShares = makeSplitShares(participants, SplitType.EQUAL, [1n, 1n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 10000n,
          participants,
          splitType: SplitType.EQUAL,
          splitShares,
          paidBy: user2,
          payers: [],
        }),
      );

      expect(result.participants[0]?.amount).toBe(-5000n);
      expect(result.participants[1]?.amount).toBe(5000n); // -5000 + 10000
    });
  });

  describe('Penny adjustment', () => {
    it('distributes leftover pennies so totals sum to zero', () => {
      const participants = makeParticipants([user1, user2, user3]);
      const splitShares = makeSplitShares(participants, SplitType.EQUAL, [1n, 1n, 1n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 10000n,
          participants,
          splitType: SplitType.EQUAL,
          splitShares,
          paidBy: user1,
        }),
      );

      // 10000 / 3 = 3333r1 → pennies distributed
      const total = result.participants.reduce((acc, p) => acc + (p.amount ?? 0n), 0n);
      expect(total).toBe(0n);
    });

    it('skips adjustment when split cannot be closed', () => {
      const participants = makeParticipants([user1, user2]);
      const splitShares = makeSplitShares(participants, SplitType.EXACT, [4000n, 3000n]);

      const result = calculateForwardSplit(
        forwardInput({
          amount: 10000n,
          participants,
          splitType: SplitType.EXACT,
          splitShares,
          paidBy: user1,
        }),
      );

      // No penny rebalancing runs because canSplitScreenClosed is false.
      expect(result.canSplitScreenClosed).toBe(false);
      // Total = (-4000 + 10000) + (-3000) = 3000 (the unresolved amount)
      const total = result.participants.reduce((acc, p) => acc + (p.amount ?? 0n), 0n);
      expect(total).toBe(3000n);
    });
  });
});

describe('calculateInverseSplit', () => {
  describe('SplitType.EQUAL', () => {
    it('sets share to 1 for participants whose net differs from paid amount', () => {
      // User3 paid 10000 as paidBy, net amounts reflect an equal 3-way split.
      const participants = makeParticipants([user1, user2, user3], [-3333n, -3333n, 6666n]);
      const splitShares = initSplitSharesFor(participants);

      calculateInverseSplit(
        inverseInput({
          amount: 10000n,
          participants,
          splitType: SplitType.EQUAL,
          splitShares,
          paidBy: user3,
        }),
      );

      // None of the participants have paid === net, so all stay at share 1.
      expect(splitShares[user1.id]![SplitType.EQUAL]).toBe(1n);
      expect(splitShares[user2.id]![SplitType.EQUAL]).toBe(1n);
      expect(splitShares[user3.id]![SplitType.EQUAL]).toBe(1n);
    });

    it('sets share to 0 when a participant paid exactly their own share', () => {
      // Fully settled payer: paid and net amount match → excluded.
      const participants = makeParticipants([user1, user2], [10000n, -10000n]);
      const splitShares = initSplitSharesFor(participants);

      calculateInverseSplit(
        inverseInput({
          amount: 10000n,
          participants,
          splitType: SplitType.EQUAL,
          splitShares,
          paidBy: user1,
        }),
      );

      expect(splitShares[user1.id]![SplitType.EQUAL]).toBe(0n);
      expect(splitShares[user2.id]![SplitType.EQUAL]).toBe(1n);
    });
  });

  describe('SplitType.PERCENTAGE', () => {
    it('recovers percentage shares from net amounts', () => {
      const participants = makeParticipants([user1, user2, user3], [-2000n, -3000n, -5000n]);
      const splitShares = initSplitSharesFor(participants);

      calculateInverseSplit(
        inverseInput({
          amount: 10000n,
          participants,
          splitType: SplitType.PERCENTAGE,
          splitShares,
        }),
      );

      expect(splitShares[user1.id]![SplitType.PERCENTAGE]).toBe(2000n); // 20%
      expect(splitShares[user2.id]![SplitType.PERCENTAGE]).toBe(3000n); // 30%
      expect(splitShares[user3.id]![SplitType.PERCENTAGE]).toBe(5000n); // 50%
    });

    it('handles zero amount by zeroing all shares', () => {
      const participants = makeParticipants([user1, user2], [-1n, -1n]);
      const splitShares = initSplitSharesFor(participants);

      calculateInverseSplit(
        inverseInput({
          amount: 0n,
          participants,
          splitType: SplitType.PERCENTAGE,
          splitShares,
        }),
      );

      expect(splitShares[user1.id]![SplitType.PERCENTAGE]).toBe(0n);
      expect(splitShares[user2.id]![SplitType.PERCENTAGE]).toBe(0n);
    });
  });

  describe('SplitType.SHARE', () => {
    it('recovers proportional share values', () => {
      const participants = makeParticipants([user1, user2, user3], [-6000n, -3000n, -3000n]);
      const splitShares = initSplitSharesFor(participants);

      calculateInverseSplit(
        inverseInput({
          amount: 12000n,
          participants,
          splitType: SplitType.SHARE,
          splitShares,
        }),
      );

      // Ratio 2:1:1, reduced by gcd then scaled by 100
      expect(splitShares[user1.id]![SplitType.SHARE]).toBe(200n);
      expect(splitShares[user2.id]![SplitType.SHARE]).toBe(100n);
      expect(splitShares[user3.id]![SplitType.SHARE]).toBe(100n);
    });
  });

  describe('SplitType.EXACT', () => {
    it('stores each participant owed amount as the exact share', () => {
      const participants = makeParticipants([user1, user2, user3], [-4000n, -3000n, -3000n]);
      const splitShares = initSplitSharesFor(participants);

      calculateInverseSplit(
        inverseInput({
          amount: 10000n,
          participants,
          splitType: SplitType.EXACT,
          splitShares,
        }),
      );

      expect(splitShares[user1.id]![SplitType.EXACT]).toBe(4000n);
      expect(splitShares[user2.id]![SplitType.EXACT]).toBe(3000n);
      expect(splitShares[user3.id]![SplitType.EXACT]).toBe(3000n);
    });

    it('handles a payer that has positive net amount', () => {
      const participants = makeParticipants([user1, user2], [6000n, -4000n]);
      const splitShares = initSplitSharesFor(participants);

      calculateInverseSplit(
        inverseInput({
          amount: 10000n,
          participants,
          splitType: SplitType.EXACT,
          splitShares,
          paidBy: user1,
        }),
      );

      // User1 paid 10000, net 6000 → owed = 10000 - 6000 = 4000
      expect(splitShares[user1.id]![SplitType.EXACT]).toBe(4000n);
      expect(splitShares[user2.id]![SplitType.EXACT]).toBe(4000n);
    });
  });

  describe('SplitType.ADJUSTMENT', () => {
    it('computes adjustments relative to the smallest non-zero owed amount', () => {
      const participants = makeParticipants([user1, user2, user3], [-3000n, -2000n, -2000n]);
      const splitShares = initSplitSharesFor(participants);

      calculateInverseSplit(
        inverseInput({
          amount: 7000n,
          participants,
          splitType: SplitType.ADJUSTMENT,
          splitShares,
        }),
      );

      // Min owed = 2000; adjustments = 1000, 0, 0
      expect(splitShares[user1.id]![SplitType.ADJUSTMENT]).toBe(1000n);
      expect(splitShares[user2.id]![SplitType.ADJUSTMENT]).toBe(0n);
      expect(splitShares[user3.id]![SplitType.ADJUSTMENT]).toBe(0n);
    });
  });

  describe('SplitType.SETTLEMENT', () => {
    it('does not mutate splitShares', () => {
      const participants = makeParticipants([user1, user2], [5000n, -5000n]);
      const splitShares = initSplitSharesFor(participants);
      const before = JSON.stringify(splitShares, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      );

      calculateInverseSplit(
        inverseInput({
          amount: 5000n,
          participants,
          splitType: SplitType.SETTLEMENT,
          splitShares,
          paidBy: user1,
        }),
      );

      const after = JSON.stringify(splitShares, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
      expect(after).toBe(before);
    });
  });

  describe('Multi-payer handling', () => {
    it('uses per-payer amounts for the owed calculation', () => {
      const participants = makeParticipants([user1, user2, user3], [3000n, 1000n, -4000n]);
      const splitShares = initSplitSharesFor(participants);
      const payers: Payer[] = [
        { user: user1, amount: 6000n },
        { user: user2, amount: 4000n },
      ];

      calculateInverseSplit(
        inverseInput({
          amount: 10000n,
          participants,
          splitType: SplitType.EXACT,
          splitShares,
          payers,
        }),
      );

      // Owed: user1=|3000-6000|=3000; user2=|1000-4000|=3000; user3=|-4000-0|=4000.
      expect(splitShares[user1.id]![SplitType.EXACT]).toBe(3000n);
      expect(splitShares[user2.id]![SplitType.EXACT]).toBe(3000n);
      expect(splitShares[user3.id]![SplitType.EXACT]).toBe(4000n);
    });
  });
});

describe('Round-trip forward → inverse', () => {
  const runRoundTrip = (
    amount: bigint,
    splitType: SplitType,
    shares: bigint[],
    paidBy: User = user1,
  ) => {
    const participants = makeParticipants([user1, user2, user3]);
    const splitShares = makeSplitShares(participants, splitType, shares);

    const forward = calculateForwardSplit(
      forwardInput({
        amount,
        participants,
        splitType,
        splitShares,
        paidBy,
      }),
    );

    const recovered = initSplitSharesFor(forward.participants);
    calculateInverseSplit(
      inverseInput({
        amount,
        participants: forward.participants,
        splitType,
        splitShares: recovered,
        paidBy,
      }),
    );

    return { forward, recovered };
  };

  it('round-trips EQUAL', () => {
    const { recovered } = runRoundTrip(15000n, SplitType.EQUAL, [1n, 1n, 1n]);
    expect(recovered[user1.id]![SplitType.EQUAL]).toBe(1n);
    expect(recovered[user2.id]![SplitType.EQUAL]).toBe(1n);
    expect(recovered[user3.id]![SplitType.EQUAL]).toBe(1n);
  });

  it('round-trips PERCENTAGE', () => {
    const { recovered } = runRoundTrip(20000n, SplitType.PERCENTAGE, [5000n, 3000n, 2000n]);
    expect(recovered[user1.id]![SplitType.PERCENTAGE]).toBe(5000n);
    expect(recovered[user2.id]![SplitType.PERCENTAGE]).toBe(3000n);
    expect(recovered[user3.id]![SplitType.PERCENTAGE]).toBe(2000n);
  });

  it('round-trips EXACT', () => {
    const { recovered } = runRoundTrip(12000n, SplitType.EXACT, [6000n, 4000n, 2000n]);
    expect(recovered[user1.id]![SplitType.EXACT]).toBe(6000n);
    expect(recovered[user2.id]![SplitType.EXACT]).toBe(4000n);
    expect(recovered[user3.id]![SplitType.EXACT]).toBe(2000n);
  });
});
