import { type Group, type GroupUser, SplitType, type User } from '@prisma/client';
import Router from 'next/router';
import { create } from 'zustand';

import { DEFAULT_CATEGORY } from '~/lib/category';
import { type CurrencyCode, parseCurrencyCode } from '~/lib/currency';
import { calculateForwardSplit, calculateInverseSplit } from '~/lib/splitCalculator';
import type { TransactionAddInputModel } from '~/types';
import { BigMath } from '~/utils/numbers';

export type Participant = User & { amount?: bigint };
export type SplitShares = Record<number, Record<SplitType, bigint | undefined>>;
export interface Payer {
  user: User;
  amount: bigint;
}
export type GroupWithUsers = Group & { groupUsers: (GroupUser & { user: User })[] };

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
    initializeGroupExpense: (group: GroupWithUsers) => void;
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
    initializeGroupExpense: (group) => {
      const { currentUser, actions } = useAddExpenseStore.getState();
      if (!currentUser) {
        return;
      }
      actions.setGroup(group);
      if (group.defaultCurrency) {
        actions.setCurrency(parseCurrencyCode(group.defaultCurrency));
      }
      const weightMap = Object.fromEntries(
        group.groupUsers.map((gu) => [gu.userId, BigInt(gu.weight ?? 1)]),
      );
      actions.setParticipants(
        [
          currentUser,
          ...group.groupUsers.map((gu) => gu.user).filter((u) => u.id !== currentUser.id),
        ],
        undefined,
        weightMap,
      );
      set({ showFriends: false, nameOrEmail: '' });
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
        // If a weightMap is provided with non-uniform weights, default to SHARE split
        // Instead of stuffing weights into EQUAL (which would show "split equally" in UI).
        const hasCustomWeights =
          weightMap &&
          Object.values(weightMap).some((w) => w !== 1n) &&
          Object.values(weightMap).length > 0;

        const splitShares = participants.reduce<SplitShares>((res, p) => {
          const shares = initSplitShares();
          if (weightMap?.[p.id] !== undefined) {
            if (hasCustomWeights) {
              shares[SplitType.SHARE] = weightMap[p.id]!;
            } else {
              shares[SplitType.EQUAL] = weightMap[p.id]!;
            }
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
          splitType = hasCustomWeights ? SplitType.SHARE : SplitType.EQUAL;
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
  const result = calculateForwardSplit({
    amount: state.amount,
    participants: state.participants,
    splitType: state.splitType,
    splitShares: state.splitShares,
    paidBy: state.paidBy,
    payers: state.payers,
    expenseDate: state.expenseDate,
  });
  return {
    ...state,
    participants: result.participants,
    canSplitScreenClosed: result.canSplitScreenClosed,
  };
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
  calculateInverseSplit({ amount, participants, splitType, splitShares, paidBy, payers });
}
