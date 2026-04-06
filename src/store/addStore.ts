import { type Group, SplitType, type User } from '@prisma/client';
import Router from 'next/router';
import { create } from 'zustand';

import { DEFAULT_CATEGORY } from '~/lib/category';
import { type CurrencyCode } from '~/lib/currency';
import type { TransactionAddInputModel } from '~/types';
import { shuffleArray } from '~/utils/array';
import { BigMath } from '~/utils/numbers';
import { cyrb128, splitmix32 } from '~/utils/random';

export type Participant = User & { amount?: bigint };
export type SplitShares = Record<number, Record<SplitType, bigint | undefined>>;
export interface Payer {
  user: User;
  amount: bigint;
}

export interface AddExpenseState {
  amount: bigint;
  amountStr: string;
  isNegative: boolean;
  currentUser?: User;
  splitType: SplitType;
  group?: Group;
  participants: Participant[];
  splitShares: SplitShares;
  description: string;
  currency: CurrencyCode;
  category: string;
  nameOrEmail: string;
  paidBy?: User;
  payers: Payer[];
  showFriends: boolean;
  isFileUploading: boolean;
  fileKey?: string;
  canSplitScreenClosed: boolean;
  splitScreenOpen: boolean;
  expenseDate: Date;
  cronExpression: string;
  transactionId?: string;
  multipleTransactions: TransactionAddInputModel[];
  isTransactionLoading: boolean;
  actions: {
    setAmount: (amount: bigint) => void;
    setAmountStr: (amountStr: string) => void;
    setSplitType: (splitType: SplitType) => void;
    setGroup: (group: Group | undefined) => void;
    addOrUpdateParticipant: (user: Participant) => void;
    setSplitShare: (splitType: SplitType, userId: number, share: bigint) => void;
    setParticipants: (
      participants: Participant[],
      splitType?: SplitType,
      weightMap?: Record<number, bigint>,
    ) => void;
    removeParticipant: (userId: number) => void;
    removeLastParticipant: () => void;
    setCurrency: (currency: CurrencyCode) => void;
    setCategory: (category: string) => void;
    setNameOrEmail: (nameOrEmail: string) => void;
    setPaidBy: (user: User) => void;
    setPayers: (payers: Payer[]) => void;
    addPayer: (user: User) => void;
    removePayer: (userId: number) => void;
    setPayerAmount: (userId: number, amount: bigint) => void;
    setCurrentUser: (user: User) => void;
    setDescription: (description: string) => void;
    setFileUploading: (isFileUploading: boolean) => void;
    setFileKey: (fileKey: string) => void;
    resetState: () => void;
    setSplitScreenOpen: (splitScreenOpen: boolean) => void;
    setExpenseDate: (expenseDate: Date | undefined) => void;
    setTransactionId: (transactionId?: string) => void;
    setMultipleTransactions: (multipleTransactions: TransactionAddInputModel[]) => void;
    setSingleTransaction: (singleTransaction: TransactionAddInputModel) => void;
    setIsTransactionLoading: (isTransactionLoading: boolean) => void;
    setCronExpression: (cronExpression: string) => void;
  };
}

export const useAddExpenseStore = create<AddExpenseState>()((set) => ({
  amount: 0n,
  amountStr: '',
  isNegative: false,
  splitType: SplitType.EQUAL,
  participants: [],
  splitShares: {
    [SplitType.EQUAL]: {},
    [SplitType.PERCENTAGE]: {},
    [SplitType.SHARE]: {},
    [SplitType.EXACT]: {},
    [SplitType.ADJUSTMENT]: {},
    [SplitType.SETTLEMENT]: {},
  },
  payers: [],
  currency: 'USD',
  category: DEFAULT_CATEGORY,
  nameOrEmail: '',
  description: '',
  showFriends: true,
  isFileUploading: false,
  canSplitScreenClosed: true,
  splitScreenOpen: false,
  expenseDate: new Date(),
  repeatEvery: 1,
  multipleTransactions: [],
  isTransactionLoading: false,
  cronExpression: '',
  actions: {
    setAmount: (realAmount) =>
      set((s) => {
        const isNegative = realAmount < 0n;
        const amount = BigMath.abs(realAmount);
        // If single payer, update their amount to match the total
        const payers =
          s.payers.length <= 1 && s.payers[0] ? [{ ...s.payers[0], amount }] : s.payers;
        return calculateParticipantSplit({ ...s, isNegative, amount, payers });
      }),
    setAmountStr: (amountStr) => set({ amountStr }),
    setSplitType: (splitType) => set((state) => calculateParticipantSplit({ ...state, splitType })),
    setSplitShare: (splitType, userId, share) =>
      set((state) => {
        const splitShares: SplitShares = {
          ...state.splitShares,
          [userId]: {
            ...(state.splitShares[userId] ?? initSplitShares()),
            [splitType]: share,
          },
        } as SplitShares;

        return calculateParticipantSplit({ ...state, splitShares });
      }),
    setGroup: (group) => {
      set({ group });
    },
    addOrUpdateParticipant: (user) =>
      set((state) => {
        const participants = [...state.participants];
        const splitShares = { ...state.splitShares };
        const userIndex = participants.findIndex((p) => p.id === user.id);
        if (-1 !== userIndex) {
          participants[userIndex] = user;
        } else {
          participants.push({ ...user });
          splitShares[user.id] = initSplitShares();
        }
        return calculateParticipantSplit({ ...state, participants, splitShares });
      }),
    setParticipants: (participants, splitType, weightMap) =>
      set((state) => {
        const splitShares = participants.reduce<SplitShares>((res, p) => {
          const shares = initSplitShares();
          if (weightMap?.[p.id] !== undefined) {
            shares[SplitType.EQUAL] = weightMap[p.id]!;
          }
          res[p.id] = shares;
          return res;
        }, {});
        if (splitType) {
          calculateSplitShareBasedOnAmount(
            state.amount,
            participants,
            splitType,
            splitShares,
            state.paidBy,
            state.payers,
          );
        } else {
          splitType = SplitType.EQUAL;
        }
        return calculateParticipantSplit({ ...state, participants, splitType, splitShares });
      }),
    removeLastParticipant: () => {
      set((state) => {
        const currentPath = window.location.pathname;
        const searchParams = new URLSearchParams(window.location.search);
        searchParams.delete('friendId');

        Router.push(`${currentPath}?${searchParams.toString()}`).catch(console.error);

        if (1 >= state.participants.length) {
          return {};
        }
        const newParticipants = [...state.participants];
        const { id } = newParticipants.pop()!;
        const { [id]: _, ...rest } = state.splitShares;
        return calculateParticipantSplit({
          ...state,
          participants: newParticipants,
          splitShares: rest,
        });
      });
    },
    removeParticipant: (userId) => {
      set((state) => {
        const currentPath = window.location.pathname;
        const searchParams = new URLSearchParams(window.location.search);
        searchParams.delete('friendId');

        Router.push(`${currentPath}?${searchParams.toString()}`).catch(console.error);

        const newParticipants = state.participants.filter((p) => p.id !== userId);
        const { [userId]: _, ...rest } = state.splitShares;
        return calculateParticipantSplit({
          ...state,
          participants: newParticipants,
          splitShares: rest,
        });
      });
    },
    setCurrency: (currency) => set({ currency }),
    setCategory: (category) => set({ category }),
    setNameOrEmail: (nameOrEmail) => set({ nameOrEmail, showFriends: 0 < nameOrEmail.length }),
    setPaidBy: (paidBy) =>
      set((state) => {
        const payers: Payer[] = [{ user: paidBy, amount: state.amount }];
        return calculateParticipantSplit({ ...state, paidBy, payers });
      }),
    setPayers: (payers) =>
      set((state) => {
        const paidBy = payers.length > 0 ? payers[0]!.user : state.paidBy;
        return calculateParticipantSplit({ ...state, paidBy, payers });
      }),
    addPayer: (user) =>
      set((state) => {
        if (state.payers.some((p) => p.user.id === user.id)) {
          return {};
        }
        const payers = [...state.payers, { user, amount: 0n }];
        return calculateParticipantSplit({ ...state, payers });
      }),
    removePayer: (userId) =>
      set((state) => {
        const payers = state.payers.filter((p) => p.user.id !== userId);
        const paidBy = payers.length > 0 ? payers[0]!.user : state.paidBy;
        return calculateParticipantSplit({ ...state, paidBy, payers });
      }),
    setPayerAmount: (userId, amount) =>
      set((state) => {
        const payers = state.payers.map((p) => (p.user.id === userId ? { ...p, amount } : p));
        return calculateParticipantSplit({ ...state, payers });
      }),
    setCurrentUser: (currentUser) =>
      set((s) => {
        const cUser = s.participants.find((p) => p.id === currentUser.id);
        const splitShares = { ...s.splitShares };
        const participants = [...s.participants];

        if (!cUser) {
          participants.push(currentUser);
        }
        if (!splitShares[currentUser.id]) {
          splitShares[currentUser.id] = initSplitShares();
        }
        return {
          currentUser,
          splitShares,
          paidBy: currentUser,
          payers: [{ user: currentUser, amount: s.amount }],
          participants,
        };
      }),
    setDescription: (description) => set({ description }),
    setFileUploading: (isFileUploading) => set({ isFileUploading }),
    setFileKey: (fileKey) => set({ fileKey }),
    resetState: () => {
      set((s) => ({
        amount: 0n,
        participants: s.currentUser ? [s.currentUser] : [],
        description: '',
        fileKey: '',
        category: DEFAULT_CATEGORY,
        splitType: SplitType.EQUAL,
        group: undefined,
        amountStr: '',
        splitShares: s.currentUser ? { [s.currentUser.id]: initSplitShares() } : {},
        isNegative: false,
        canSplitScreenClosed: true,
        splitScreenOpen: false,
        expenseDate: new Date(),
        transactionId: undefined,
        multipleTransactions: [],
        isTransactionLoading: false,
        cronExpression: '',
        isFileUploading: false,
        paidBy: s.currentUser,
        payers: s.currentUser ? [{ user: s.currentUser, amount: 0n }] : [],
      }));
    },
    setSplitScreenOpen: (splitScreenOpen) => set({ splitScreenOpen }),
    setExpenseDate: (expenseDate) => set({ expenseDate }),
    setTransactionId: (transactionId) => set({ transactionId }),
    setMultipleTransactions: (multipleTransactions) => set({ multipleTransactions }),
    setSingleTransaction: (singleTransaction: TransactionAddInputModel) =>
      set((s) => {
        const isNegative = singleTransaction.amount < 0n;
        const amount = BigMath.abs(singleTransaction.amount);
        return {
          ...calculateParticipantSplit({ ...s, amount, isNegative }),
          expenseDate: singleTransaction.date,
          description: singleTransaction.description,
          currency: singleTransaction.currency,
          amountStr: singleTransaction.amountStr,
          transactionId: singleTransaction.transactionId,
        };
      }),
    setIsTransactionLoading: (isTransactionLoading) => set({ isTransactionLoading }),
    setCronExpression: (cronExpression) => set({ cronExpression }),
  },
}));

export function calculateParticipantSplit(
  state: Pick<
    AddExpenseState,
    | 'amount'
    | 'participants'
    | 'splitType'
    | 'splitShares'
    | 'paidBy'
    | 'payers'
    | 'expenseDate'
    | 'isNegative'
  >,
) {
  const { amount, participants, splitType, splitShares, paidBy, payers, expenseDate } = state;
  let canSplitScreenClosed = true;
  if (0n === amount) {
    return { ...state, canSplitScreenClosed };
  }

  let updatedParticipants = participants;

  const getSplitShare = (p: Participant) => splitShares[p.id]?.[splitType];

  switch (splitType) {
    case SplitType.EQUAL:
      const getWeight = (p: Participant) => {
        const share = getSplitShare(p);
        if (undefined === share) {
          return 1n;
        }
        return share;
      };
      const totalWeight = participants.reduce((acc, p) => acc + getWeight(p), 0n);
      updatedParticipants = participants.map((p) => ({
        ...p,
        amount: 0n === getWeight(p) ? 0n : (amount * getWeight(p)) / totalWeight,
      }));
      canSplitScreenClosed = Boolean(
        Object.values(splitShares).find((p) => 0n !== p[SplitType.EQUAL]),
      );
      break;
    case SplitType.PERCENTAGE:
      updatedParticipants = participants.map((p) => ({
        ...p,
        amount: ((getSplitShare(p) ?? 0n) * amount) / 10000n,
      }));
      canSplitScreenClosed =
        0 === 100 - participants.reduce((acc, p) => acc + Number(getSplitShare(p) ?? 0n) / 100, 0);
      break;
    case SplitType.SHARE:
      const totalShare = participants.reduce((acc, p) => acc + Number(getSplitShare(p) ?? 0n), 0);
      canSplitScreenClosed = 0 < totalShare;
      updatedParticipants = participants.map((p) => ({
        ...p,
        amount:
          0n === (getSplitShare(p) ?? 0n)
            ? 0n
            : ((getSplitShare(p) ?? 0n) * amount) / BigInt(Math.round(totalShare)),
      }));
      break;
    case SplitType.EXACT:
      const totalSplitShare = participants.reduce((acc, p) => acc + (getSplitShare(p) ?? 0n), 0n);

      canSplitScreenClosed = amount === totalSplitShare;

      updatedParticipants = participants.map((p) => ({ ...p, amount: getSplitShare(p) }));

      break;
    case SplitType.ADJUSTMENT:
      const totalAdjustment = participants.reduce((acc, p) => acc + (getSplitShare(p) ?? 0n), 0n);
      if (totalAdjustment > amount) {
        canSplitScreenClosed = false;
      }
      const remainingAmountShare = (amount - totalAdjustment) / BigInt(participants.length);
      updatedParticipants = participants.map((p) => ({
        ...p,
        amount: remainingAmountShare + (getSplitShare(p) ?? 0n),
      }));
      break;
  }

  // Calculate net position: amountPaid - share for each participant
  // With multi-payer, each participant's paid amount comes from the payers array
  const payerMap = new Map<number, bigint>();
  if (payers && payers.length > 0) {
    for (const p of payers) {
      payerMap.set(p.user.id, p.amount);
    }
  } else if (paidBy) {
    payerMap.set(paidBy.id, amount);
  }

  updatedParticipants = updatedParticipants.map((p) => {
    const paidAmount = payerMap.get(p.id) ?? 0n;
    return { ...p, amount: -(p.amount ?? 0n) + paidAmount };
  });

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
        p.amount! -= BigMath.sign(penniesLeft);
        penniesLeft -= BigMath.sign(penniesLeft);
        i++;
      }
    }
  }

  return { ...state, participants: updatedParticipants, canSplitScreenClosed };
}

export const initSplitShares = (): Record<SplitType, bigint | undefined> => {
  const shares = Object.fromEntries(
    Object.values(SplitType).map((type) => [type, undefined]),
  ) as Record<SplitType, bigint | undefined>;
  shares[SplitType.EQUAL] = 1n;
  return shares;
};

export function calculateSplitShareBasedOnAmount(
  amount: bigint,
  participants: Participant[],
  splitType: SplitType,
  splitShares: SplitShares,
  paidBy?: User,
  payers?: Payer[],
) {
  // Build a map of how much each person paid
  const payerMap = new Map<number, bigint>();
  if (payers && payers.length > 0) {
    for (const p of payers) {
      payerMap.set(p.user.id, p.amount);
    }
  } else if (paidBy) {
    payerMap.set(paidBy.id, amount);
  }

  const getShare = (p: Participant): bigint => {
    const paidAmount = payerMap.get(p.id) ?? 0n;
    return BigMath.abs((p.amount ?? 0n) - paidAmount);
  };

  switch (splitType) {
    case SplitType.EQUAL:
      participants.forEach((p) => {
        const paidAmount = payerMap.get(p.id) ?? 0n;
        splitShares[p.id]![splitType] =
          paidAmount === p.amount && participants.length > 1 ? 0n : 1n;
      });

      break;

    case SplitType.PERCENTAGE:
      participants.forEach((p) => {
        splitShares[p.id]![splitType] = 0n === amount ? 0n : (getShare(p) * 10000n) / amount;
      });

      break;

    case SplitType.SHARE:
      const amounts = participants
        .filter(({ amount }) => Boolean(amount))
        .map((p) => getShare(p))
        .filter((s) => s !== 0n);

      const gcdValue = amounts.length > 1 ? amounts.reduce((a, b) => BigMath.gcd(a, b)) : 1n;

      participants.forEach((p) => {
        splitShares[p.id]![splitType] = 0n === amount ? 0n : (getShare(p) * 100n) / gcdValue;
      });

      break;

    case SplitType.EXACT:
      participants.forEach((p) => {
        splitShares[p.id]![splitType] = getShare(p);
      });

      break;

    case SplitType.ADJUSTMENT:
      const shareAmounts = participants
        .filter(({ amount }) => 0n !== amount)
        .map((p) => getShare(p));

      const minAmount = shareAmounts.length > 0 ? BigMath.min(...shareAmounts) : 0n;

      participants.forEach((p) => {
        splitShares[p.id]![splitType] = getShare(p) - minAmount;
      });

      break;
  }
}
