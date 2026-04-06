import { type BalanceView, type Prisma } from '@prisma/client';

import { simplifyDebts } from '~/lib/simplify';
import { db } from '~/server/db';

export interface ProcessedBalance {
  userId: number;
  friendId: number;
  groupId: number | null;
  currency: string;
  amount: bigint;
  createdAt: Date;
  updatedAt: Date;
  group: { simplifyDebts: boolean; name: string } | null;
}

export interface GetProcessedBalancesOptions {
  /** User whose balances are being fetched (BalanceView is per-user). */
  userId: number;
  /** Restrict to a single friend. */
  friendId?: number;
  /** Exclude specific friendIds (e.g., hidden friends). */
  excludeFriendIds?: number[];
  /** Restrict to balances in a specific group. */
  groupId?: number;
  /** Only include rows where amount != 0. */
  nonZeroOnly?: boolean;
}

/**
 * Fetch balances from BalanceView and apply per-group debt simplification.
 *
 * For rows belonging to groups with `simplifyDebts` enabled, the row's amount
 * is replaced with the current user's simplified balance against that friend
 * in that group. Non-simplified rows are returned as-is.
 *
 * Shared logic used by expense.getBalances, user.getBalancesWithFriend, and
 * (via {@link applyGroupSimplify}) group.getGroupDetails.
 */
export async function getProcessedBalances(
  options: GetProcessedBalancesOptions,
): Promise<ProcessedBalance[]> {
  const where: Prisma.BalanceViewWhereInput = {
    userId: options.userId,
  };

  if (options.friendId !== undefined) {
    where.friendId = options.friendId;
  } else if (options.excludeFriendIds) {
    where.friendId = { notIn: options.excludeFriendIds };
  }

  if (options.groupId !== undefined) {
    where.groupId = options.groupId;
  }

  if (options.nonZeroOnly) {
    where.amount = { not: 0 };
  }

  const rawBalances = await db.balanceView.findMany({
    where,
    include: {
      group: {
        select: {
          simplifyDebts: true,
          name: true,
        },
      },
    },
  });

  return Promise.all(
    rawBalances.map(
      async ({
        userId,
        friendId,
        groupId,
        currency,
        amount,
        createdAt,
        updatedAt,
        group,
      }): Promise<ProcessedBalance> => {
        if (!group?.simplifyDebts || null === groupId) {
          return { userId, friendId, groupId, currency, amount, createdAt, updatedAt, group };
        }

        const allGroupBalances = await db.balanceView.findMany({
          where: { groupId, currency },
        });

        const simplified = simplifyDebts(allGroupBalances);
        const mine = simplified.find(
          (b) => b.userId === userId && b.friendId === friendId && b.currency === currency,
        );

        return {
          userId,
          friendId,
          groupId,
          currency,
          amount: mine?.amount ?? 0n,
          createdAt,
          updatedAt,
          group,
        };
      },
    ),
  );
}

/**
 * Apply debt simplification to an already-fetched list of group balances.
 * Use this when the full set of balances for a group is already in hand
 * (e.g. via the `Group.groupBalances` relation).
 */
export function applyGroupSimplify(balances: BalanceView[]): BalanceView[] {
  return simplifyDebts(balances);
}
