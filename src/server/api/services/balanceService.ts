import { type BalanceView, type Prisma } from '@prisma/client';

import { simplifyDebts } from '~/lib/simplify';
import { db } from '~/server/db';

export type BalanceWithGroup = BalanceView & {
  group: { name: string; simplifyDebts: boolean } | null;
};

export interface GetProcessedBalancesOptions {
  userId?: number;
  friendId?: number;
  groupId?: number;
  hiddenFriendIds?: number[];
  excludeZero?: boolean;
}

/**
 * Fetch balance records and apply debt simplification for groups that have
 * simplifyDebts enabled.
 *
 * Balances in non-simplified groups (and non-group balances) are returned
 * as-is. Balances in simplified groups are replaced with their simplified
 * counterpart computed from the full set of balances for that (group,
 * currency) pair.
 */
export const getProcessedBalances = async ({
  userId,
  friendId,
  groupId,
  hiddenFriendIds,
  excludeZero = false,
}: GetProcessedBalancesOptions): Promise<BalanceWithGroup[]> => {
  const where: Prisma.BalanceViewWhereInput = {};
  if (userId !== undefined) {
    where.userId = userId;
  }
  if (groupId !== undefined) {
    where.groupId = groupId;
  }
  if (friendId !== undefined) {
    where.friendId = friendId;
  } else if (hiddenFriendIds && 0 < hiddenFriendIds.length) {
    where.friendId = { notIn: hiddenFriendIds };
  }
  if (excludeZero) {
    where.amount = { not: 0 };
  }

  const rawBalances = await db.balanceView.findMany({
    where,
    include: {
      group: {
        select: {
          name: true,
          simplifyDebts: true,
        },
      },
    },
  });

  /*
   * Cache simplified balances per (groupId, currency) to avoid repeated queries
   * and recomputation when many input balances share the same group.
   */
  const simplifiedCache = new Map<string, BalanceView[]>();
  const getSimplifiedForGroupCurrency = async (
    gid: number,
    currency: string,
  ): Promise<BalanceView[]> => {
    const key = `${gid}:${currency}`;
    const cached = simplifiedCache.get(key);
    if (cached) {
      return cached;
    }
    const allGroupBalances = await db.balanceView.findMany({
      where: { groupId: gid, currency },
    });
    const simplified = simplifyDebts(allGroupBalances);
    simplifiedCache.set(key, simplified);
    return simplified;
  };

  return Promise.all(
    rawBalances.map(async (balance): Promise<BalanceWithGroup> => {
      if (!balance.group?.simplifyDebts || null === balance.groupId) {
        return balance;
      }

      const simplified = await getSimplifiedForGroupCurrency(balance.groupId, balance.currency);
      const simplifiedBalance = simplified.find(
        (b) =>
          b.userId === balance.userId &&
          b.friendId === balance.friendId &&
          b.currency === balance.currency,
      );

      balance.amount = simplifiedBalance?.amount ?? 0n;
      return balance;
    }),
  );
};
